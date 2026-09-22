import {collectWarps} from './visuals/warps.ts';
import {sampleVisual,disposeVisual} from './visuals/runtime.ts';
import {sampleFields,sampleParticleFields} from './visuals/fields.ts';
import {DeformationRuntime} from './visuals/deformation.ts';
import { SurfaceRuntime } from './media/surface-runtime.ts';
import { SceneLighting } from './lighting/runtime.ts';
import { installWallTransmission, isWallEntity } from './lighting/wall-transmission.ts';
import { fitFeetToSurface } from './editor/foot-contact.ts';
import { SceneRenderCache } from './editor/scene-render-cache.ts';
import { ReferenceLabels } from './production/reference-labels.ts';
import { cameraLookAt } from './animation/camera-look.ts';
import { applyCameraEffects, cameraFocal, cameraFocusDistance } from './cinematography/camera-effects.ts';
import { cameraAimResponseQuaternion } from './cinematography/aim-response.ts';
import { ShotEffects } from './cinematography/shot-effects.ts';
import { addZoneHelpers } from './editor/zone-helpers.ts';
import { InitialPoseRuntime } from './scenes/initial-pose-runtime.ts';
import { inheritedPoseAt } from './scenes/initial-pose.ts';
import { shotEntityVisible } from './scenes/camera-visibility.ts';
import { editorEntityVisible, workingElevation } from './building/floors.ts';
import { ContactMarker } from './editor/contact-marker.ts';
import { applyHandBinding, type HandBinding } from './animation/hand-binding.ts';
import { builtinHandFrame } from './animation/hand-frame.ts';
import { footSurfaceQuery } from './animation/contact-surfaces.ts';
import { transitionGroundingAt } from './animation/transition-plan.ts';
import { SceneModels } from './resources/scene-models.ts';
import { isExternalModel } from './resources/project-resources.ts';
import { makeCrowd } from './assets/crowd.ts';
import { collectSpatialReport, type SpatialOptions } from './spatial/report.ts';
import * as T from 'three';
import { objectBounds, findObjectSnap, type SnapBounds } from './editor/object-snapping.ts';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { Rig } from './assets.ts';
import { animateHuman, disposeTree, makeProp, makeRoom } from './assets.ts';
import { scaleHuman, colorHuman } from './assets/humanoid.ts';
import { makeActor, animateActor } from './assets/actors.ts';
import { applyHumanPose } from './assets/human-animation.ts';
import { crowdAnimationPhase } from './resources/retarget-animation.ts';
import type { Entity, Project, Vec3 } from './model.ts';
import { aspectNumber } from './model.ts';
import { activeCameraId, entityPosition, entityYaw, sampledAction, pathPosition } from './timeline.ts';
export function configureCamera(camera: T.PerspectiveCamera, focal: number, aspect: number) {
    camera.aspect = aspect;
    camera.filmGauge = 36;
    camera.setFocalLength(focal);
    camera.near = .025;
    camera.far = 2000;
    camera.updateProjectionMatrix();
}
interface Callbacks {
    select: (id: string) => void;
    point: (index: number) => void;
    ground: (point: Vec3) => void;
    transformStart: () => void;
    transform: (position: Vec3, rotation: Vec3, scale: Vec3) => void;
    transformEnd: (cancel?:boolean) => void;
}
export class Engine {
    deformations=new DeformationRuntime();
    surfaces = new SurfaceRuntime(() => { this.needsRender = true; });
    async prepareOutput(time:number,signal?:AbortSignal) { this.sample(time); signal?.throwIfAborted(); await this.surfaces.prepare(); signal?.throwIfAborted(); }
    private shotEffects = new ShotEffects();
    private lighting: SceneLighting;
    private renderCache = new SceneRenderCache();
    private roomKey = '';
    private referenceLabels = new ReferenceLabels();
    private initialPoses = new InitialPoseRuntime();
    externalModels = new SceneModels();
    scene = new T.Scene();
    editorCamera = new T.PerspectiveCamera(45, 1, .03, 2000);
    editorRenderer: T.WebGLRenderer;
    shotRenderer: T.WebGLRenderer;
    orbit: OrbitControls;
    gizmo: TransformControls;
    models = new Map<string, T.Group>();
    rigs = new Map<string, Rig>();
    cameras = new Map<string, T.PerspectiveCamera>();
    crowdRigs = new Map<string, Rig[]>();
    walls = new Map<string, T.Group>();
    roomGroup = new T.Group();
    helpers = new T.Group();
    pathHelpers = new T.Group();
    cameraVisuals = new Map<string, T.Group>();
    proxy = new T.Group();
    selected = '';
    selectedPoint = -1;
    drawingPath = false;
    positionKeying = false;
    dragging = false;
    pickingEnabled = true;
    gridVisible = true;
    placementSnap = 0;
    objectSnapEnabled = false;
    objectSnapTarget = '';
    pathSurfaceMode: 'surface' | 'ground' = 'surface';
    private snapTargets: SnapBounds[] | null = null;
    private contactMarker = new ContactMarker();
    showContactAnchor(entityId = '', anchorId = '') {
        this.needsRender = true;
        this.contactMarker.show(entityId, anchorId, this.helpers);
        this.contactMarker.update(this.project.entities, this.models);
    }
    handFrame(binding: Pick<HandBinding, 'actorId' | 'hand'>) {
        const actor = this.project.entities.find(e => e.id === binding.actorId); if (!actor) throw Error('绑定人物已不存在');
        return actor.external ? this.externalModels.handFrame(actor, binding.hand) : builtinHandFrame(actor, this.rigs.get(actor.id)!, binding.hand);
    }
    project: Project;
    time = 0;
    previewId = 'program';
    onFrame = () => { };
    selectionBox: T.BoxHelper | null = null;
    disposed = false;
    exporting = false;
    monochrome = false;
    previewQuality: 'full' | 'draft' = 'full';
    setPreviewQuality(value: 'full' | 'draft') { this.previewQuality = value; this.resizeNeeded = true; this.sample(this.time); this.render(); }
    private cb: Callbacks;
    private pointerDown = [0, 0];
    private stage: HTMLElement;
    private shot: HTMLElement;
    private resizeObserver: ResizeObserver;
    private resizeNeeded = true;
    private needsRender = true;
    private renderedView = '';
    private events = new AbortController();
    constructor(project: Project, stage: HTMLElement, shot: HTMLElement, callbacks: Callbacks) {
        this.project = project;
        this.stage = stage;
        this.shot = shot;
        this.cb = callbacks;
        this.scene.background = new T.Color('#c6c8c6');
        this.lighting = new SceneLighting(this.scene);
        this.editorRenderer = this.renderer();
        this.shotRenderer = this.renderer();
        stage.append(this.editorRenderer.domElement);
        shot.append(this.shotRenderer.domElement);
        this.editorRenderer.domElement.setAttribute('aria-label', '三维布景视图');
        this.shotRenderer.domElement.setAttribute('aria-label', '摄影机真实取景');
        this.editorCamera.position.set(7, 5.9, 7);
        this.editorCamera.layers.enable(1);
        this.orbit = new OrbitControls(this.editorCamera, this.editorRenderer.domElement);
        this.orbit.addEventListener('change', () => { this.needsRender = true; });
        this.orbit.target.set(0, .85, 0);
        this.orbit.enableDamping = true;
        this.orbit.minDistance = .3;
        this.orbit.maxDistance = 100;
        this.orbit.maxPolarAngle = Math.PI * .49;
        this.orbit.update();
        this.scene.add(this.helpers, this.pathHelpers, this.proxy);
        this.gizmo = new TransformControls(this.editorCamera, this.editorRenderer.domElement);
        this.gizmo.addEventListener('change', () => { this.needsRender = true; });
        this.gizmo.setSize(.78);
        const helper = this.gizmo.getHelper();
        helper.traverse(o => o.layers.set(1));
        this.gizmo.getRaycaster().layers.enable(1);
        this.scene.add(helper);
        this.gizmo.addEventListener('mouseDown', () => { this.dragging = true; this.orbit.enabled = false; this.objectSnapTarget = ''; this.snapTargets = null; this.cb.transformStart(); });
        this.gizmo.addEventListener('objectChange', () => { if (this.dragging)
            this.cb.transform(this.proxy.position.toArray() as Vec3, [this.proxy.rotation.x, this.proxy.rotation.y, this.proxy.rotation.z], this.proxy.scale.toArray() as Vec3); });
        this.gizmo.addEventListener('mouseUp', () => this.finishTransform());
        const canvas = this.editorRenderer.domElement;
        const signal = this.events.signal;
        canvas.addEventListener('pointercancel',()=>this.finishTransform(true), { signal });
        window.addEventListener('blur',()=>this.finishTransform(true), { signal });
        document.addEventListener('keydown',event=>{if(event.key==='Escape' && this.dragging){event.preventDefault();this.finishTransform(true);}}, { capture: true, signal });
        canvas.addEventListener('pointerdown', e => this.pointerDown = [e.clientX, e.clientY], { signal });
        canvas.addEventListener('pointerup', e => this.pick(e), { signal });
        canvas.addEventListener('dblclick', () => { if (this.pickingEnabled) this.focus(this.selected); }, { signal });
        this.resizeObserver = new ResizeObserver(() => this.resizeNeeded = true);
        this.resizeObserver.observe(stage);
        this.resizeObserver.observe(shot);
        this.rebuild(project);
    }
    private renderer() { const r = new T.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true }); r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap; r.outputColorSpace = T.SRGBColorSpace; r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; return r; }
    rebuild(project: Project) {
        this.externalModels.assertReady(project);
        this.referenceLabels.clear();
        this.gizmo.detach();
        const changes = this.renderCache.reconcile(project.entities, this.models.keys());
        for (const id of changes.removed) {
            this.surfaces.remove(id);this.deformations.remove(id);
            const visualRoot=this.models.get(id);if(visualRoot)disposeVisual(visualRoot);
            const external = this.externalModels.removeInstance(id, this.crowdRigs.get(id)?.map((_, i) => `${id}:${i}`));
            const root = this.models.get(id); if (root && !external) disposeTree(root);
            this.models.delete(id); this.rigs.delete(id); this.crowdRigs.delete(id);
            this.cameras.delete(id); this.cameraVisuals.delete(id); this.initialPoses.remove(id);
        }
        this.project = project;
        const roomKey = JSON.stringify(project.room);
        if (roomKey !== this.roomKey) {
            disposeTree(this.roomGroup);
            const room = makeRoom(project);
            this.roomGroup = room.group; this.walls = room.walls;
            this.walls.forEach(wall => installWallTransmission(wall));
            this.scene.add(this.roomGroup); this.roomKey = roomKey;
        }
        try {
        for (const e of changes.added) {
            let root: T.Group;
            if (isExternalModel(e)) root = this.externalModels.create(e);
            else if (e.kind === 'actor') {
                const r = makeActor(e);
                root = r.root;
                this.rigs.set(e.id, r);
                this.externalModels.registerHuman(e, r);
            }
            else if (e.kind === 'crowd') {
                const crowd = makeCrowd(e); root = crowd.root;
                crowd.rigs.forEach((rig, i) => this.externalModels.registerHuman(e, rig, `${e.id}:${i}`));
                this.crowdRigs.set(e.id, crowd.rigs);
            }
            else if (e.kind === 'camera') {
                root = new T.Group();
                const cam = new T.PerspectiveCamera();
                this.cameras.set(e.id, cam);
                const body = new T.Mesh(new T.BoxGeometry(.15, .11, .2), new T.MeshBasicMaterial({ color: e.color, wireframe: true }));
                root.add(body);
                const cone = new T.Mesh(new T.ConeGeometry(.15, .25, 4, 1, true), new T.MeshBasicMaterial({ color: e.color, wireframe: true }));
                cone.rotation.x = Math.PI / 2;
                cone.rotation.y = Math.PI / 4;
                cone.position.z = -.19;
                root.add(cone);
                root.traverse(o => o.layers.set(1));
                this.cameraVisuals.set(e.id, root);
            }
            else
                root = makeProp(e);
            root.traverse(o => o.userData.entityId = e.id);
            if (isWallEntity(e)) installWallTransmission(root);
            this.models.set(e.id, root);
            this.initialPoses.register(e, root);
            this.scene.add(root);
        }
        changes.commit();
        } catch (error) { this.renderCache.invalidate(); throw error; }
        this.select(this.selected, this.selectedPoint);
        this.sample(this.time);
        this.resizeNeeded = true;
    }
    private finishTransform(cancel=false) {
        if(!this.dragging)return;
        this.dragging=false;this.gizmo.dragging=false;this.orbit.enabled=true;this.snapTargets=null;
        this.cb.transformEnd(cancel);
    }
    sample(time: number) {
        this.needsRender = true;
        this.time = time;
        for (const e of this.project.entities) {
            const root = this.models.get(e.id)!;
            this.initialPoses.restore(e);
            root.visible = e.visible;
            root.position.copy(entityPosition(e, time));
            root.rotation.set(e.rotation[0], e.kind === 'actor' || e.kind === 'crowd' ? entityYaw(e, time, this.project) : e.rotation[1], e.rotation[2]);
            if (isExternalModel(e)) this.externalModels.sample(e, this.monochrome, time);
            else if (e.kind === 'actor') {
                const r = this.rigs.get(e.id)!;
                scaleHuman(r, e);
                if (this.externalModels.sampleHuman(e, time)) applyHumanPose(r, e, time);
                else animateActor(r, e, time);
                colorHuman(r, this.monochrome ? '#d9dcd7' : e.color);
            }
            else {
                root.scale.fromArray(e.scale);
                if (e.kind === 'crowd')
                    this.crowdRigs.get(e.id)?.forEach((r, i) => { const phase = crowdAnimationPhase(e.seed, i);
                        if (this.externalModels.sampleHuman(e, time, `${e.id}:${i}`, phase)) applyHumanPose(r, e, time); else animateHuman(r, e, time, phase);
                        colorHuman(r, this.monochrome ? '#d9dcd7' : e.color); });
            }
        }
        this.deformations.prepareVisuals();
        for(const e of this.project.entities)if(e.visual||e.field||e.warp)sampleVisual(e,this.models.get(e.id)!,time,this.previewQuality==='draft'&&!this.exporting);
        for(const e of this.project.entities)if(e.visual?.preset==='portal'){const mesh=this.models.get(e.id)?.children[0];if(mesh)mesh.userData.portalCamera=this.cameras.get(e.visual.cameraId??'');}
        sampleFields(this.project.entities,this.models,time);sampleParticleFields(this.project.entities,this.models,time);
        this.deformations.sample(this.project.entities,this.models,time);
        this.scene.updateMatrixWorld(true);
        for (const e of this.project.entities) if (this.initialPoses.apply(e, time)) {
            const rig = this.rigs.get(e.id); if (rig) applyHumanPose(rig, e, time);
            this.crowdRigs.get(e.id)?.forEach(r => applyHumanPose(r, e, time));
        }
        const grounded = this.project.entities.filter(e => e.visible && !inheritedPoseAt(e, time) && transitionGroundingAt(e, time));
        if (grounded.length) {
            const surfaces = this.project.entities.filter(e => e.kind === 'prop' && !e.light && e.visible && !e.handBinding).map(e => this.models.get(e.id)!);
            if (this.project.room.enabled) surfaces.push(this.roomGroup);
            const query = footSurfaceQuery(surfaces);
            for (const e of grounded) {
                const root = this.models.get(e.id)!;
                const samplePose = (id: string, rig?: Rig, phase = 0) => (entity: Entity, at: number) => {
                    root.position.copy(entityPosition(entity, at));
                    root.rotation.set(entity.rotation[0], entityYaw(entity, at, this.project), entity.rotation[2]);
                    if (entity.external) this.externalModels.sample(entity, this.monochrome, at);
                    else if (rig) {
                        if (this.externalModels.sampleHuman(entity, at, id, phase)) applyHumanPose(rig, entity, at);
                        else animateHuman(rig, entity, at, phase);
                    }
                    root.updateWorldMatrix(true, true); root.updateMatrixWorld(true);
                };
                if (e.kind === 'crowd') this.crowdRigs.get(e.id)?.forEach((rig, i) => {
                    const id = `${e.id}:${i}`, phase = crowdAnimationPhase(e.seed, i);
                    this.externalModels.groundHuman(e, time, query, id, samplePose(id, rig, phase), phase);
                });
                else this.externalModels.groundHuman(e, time, query, e.id, samplePose(e.id, this.rigs.get(e.id)));
            }
        }
        const contactActors=this.project.entities.filter(e=>e.kind==='actor' && e.visible && !inheritedPoseAt(e,time) && e.footContact && ['idle','walk','run','wave','point','turn'].includes(sampledAction(e,time).action));
        if(contactActors.length){
            const surfaces=this.project.entities.filter(e=>e.kind==='prop'&&!e.light&&e.visible&&!e.handBinding).map(e=>this.models.get(e.id)!);
            if(this.project.room.enabled)surfaces.push(this.roomGroup);
            const ray=new T.Raycaster();ray.ray.direction.set(0,-1,0);ray.far=2;
            const surface=(x:number,y:number,z:number)=>{
                ray.ray.origin.set(x,y,z);
                const hit=ray.intersectObjects(surfaces,true).find(h=>h.face && h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.5);
                return hit?.point.y ?? (y>=0 && y<=2 ? 0 : null);
            };
            contactActors.forEach(e=>fitFeetToSurface(this.rigs.get(e.id)!,surface));
        }
        for (const e of this.project.entities) if (e.handBinding) {
            const root = this.models.get(e.id)!;
            applyHandBinding(root, e.handBinding, this.handFrame(e.handBinding));
            root.visible = e.visible && !!this.project.entities.find(a => a.id === e.handBinding!.actorId)?.visible;
        }
        this.contactMarker.update(this.project.entities, this.models);
        this.surfaces.textures.maxEdge=this.previewQuality==='draft'&&!this.exporting?1024:2048;
        this.surfaces.sample(this.project,this.models,time);
        this.lighting.sample(this.scene, this.project.lighting, this.project.entities, this.models, time, [this.editorRenderer, this.shotRenderer]);
        for (const e of this.project.entities.filter(x => x.kind === 'camera')) {
            const c = e.camera!, camera = this.cameras.get(e.id)!;
            camera.position.copy(entityPosition(e, time));
            const target = c.targetId ? this.project.entities.find(x => x.id === c.targetId) : null;
            if ((c.mode === 'follow' || c.mode === 'pov') && target) {
                const targetRoot = this.models.get(target.id)!;
                const offset = new T.Vector3(...c.offset);
                if (c.mode === 'pov') {
                    const rig = this.rigs.get(target.id);
                    if (rig && c.inheritRotation) {
                        offset.y -= rig.headRestHeight ?? 1.53;
                        camera.position.copy(rig.head.localToWorld(offset));
                        const q = rig.head.getWorldQuaternion(new T.Quaternion());
                        camera.lookAt(camera.position.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(q)));
                    }
                    else {
                        camera.position.copy(targetRoot.localToWorld(offset));
                        const q = targetRoot.getWorldQuaternion(new T.Quaternion());
                        camera.lookAt(camera.position.clone().add(new T.Vector3(0, 0, 1).applyQuaternion(q)));
                    }
                }
                else {
                    const lagTime = Math.max(0, time - (c.effects?.followLag ?? 0));
                    if (c.inheritRotation)
                        offset.applyAxisAngle(new T.Vector3(0, 1, 0), c.effects?.followLag ? entityYaw(target, lagTime, this.project) : targetRoot.rotation.y);
                    camera.position.copy(c.effects?.followLag && !target.handBinding ? entityPosition(target, lagTime) : targetRoot.position).add(offset);
                    camera.lookAt(this.targetPosition(e));
                }
            }
            else if (c.aim === 'manual')
                camera.rotation.set(...e.rotation);
            else
                camera.lookAt(this.targetPosition(e));
            const aimResponse = cameraAimResponseQuaternion(e, this.project, time, target ? this.models.get(target.id) : undefined);
            if (aimResponse) camera.quaternion.copy(aimResponse);
            configureCamera(camera, cameraFocal(c.effects, time, c.focal, camera.position.distanceTo(this.targetPosition(e))), aspectNumber(this.project.aspect));
            applyCameraEffects(camera, c.effects, time);
            camera.updateMatrixWorld(true);
            const visual = this.cameraVisuals.get(e.id)!;
            visual.position.copy(camera.position);
            visual.quaternion.copy(camera.quaternion);
            visual.visible = e.visible;
        }
        if (!this.dragging)
            this.syncProxy();
        this.selectionBox?.update();
    }
    targetPosition(e: Entity) { const c = e.camera!; if (c.targetPath) return cameraLookAt(c.targetPath, this.time); const target = this.project.entities.find(x => x.id === c.targetId); return target ? (this.models.get(target.id)?.position.clone()??entityPosition(target, this.time)).add(new T.Vector3(0, c.targetHeight, 0)) : new T.Vector3(...c.target); }
    cameraEntity(id = this.previewId) { const realId = id === 'program' ? activeCameraId(this.project, this.time) : id; return this.project.entities.find(e => e.id === realId && e.kind === 'camera') ?? this.project.entities.find(e => e.kind === 'camera')!; }
    getShotCamera(id = this.previewId) { return this.cameras.get(this.cameraEntity(id).id)!; }
    spatialReport(options: SpatialOptions = {}) {
        if (this.exporting || this.dragging || this.drawingPath || this.disposed) throw new Error('请先结束导出、拖动或画路径操作，再查询空间');
        const at = options.time ?? this.time, cameraId = options.cameraId ?? this.previewId;
        if (!Number.isFinite(at) || at < 0 || at > this.project.duration) throw new Error('查询时间必须在场景时长内');
        if (cameraId !== 'program' && !this.cameras.has(cameraId)) throw new Error('查询摄影机不存在');
        const previous = this.time;
        try { this.sample(at); return collectSpatialReport(this, cameraId, options.includeCrowdMembers ?? true, options.occlusionKeys); }
        finally { this.sample(previous); }
    }
    select(id: string, point = -1) { this.selected = id; this.selectedPoint = point; this.setPlacementSnap(this.placementSnap); this.refreshHelpers(); this.syncProxy(); const e = this.project.entities.find(e => e.id === id); if (e && !e.locked && !this.drawingPath && editorEntityVisible(this.project, e))
        this.gizmo.attach(this.proxy);
    else
        this.gizmo.detach(); }
    syncProxy() {
        if (this.dragging)
            return;
        const e = this.project.entities.find(x => x.id === this.selected);
        if (!e)
            return;
        const point = this.selectedPoint >= 0 ? e.path?.points[this.selectedPoint] : null;
        if (!point) this.selectedPoint = -1;
        this.proxy.position.copy(point ? new T.Vector3(...point.position) : entityPosition(e, this.time));
        this.proxy.rotation.fromArray([e.rotation[0], e.rotation[1], e.rotation[2], 'XYZ']);
        this.proxy.scale.fromArray(point ? [1, 1, 1] : e.scale);
        if (e.handBinding) { const root = this.models.get(e.id)!; this.proxy.position.copy(root.position); this.proxy.quaternion.copy(root.quaternion); }
        if (e.kind === 'camera' && !point)
            this.proxy.position.copy(this.cameras.get(e.id)!.position);
    }
    setTransformMode(mode: 'translate' | 'rotate' | 'scale') { this.gizmo.setMode(mode); this.gizmo.showY = true; this.gizmo.showX = true; this.gizmo.showZ = true; }
    setPlacementSnap(step: number) { this.placementSnap = step; const prop = this.project.entities.find(e => e.id === this.selected)?.kind === 'prop'; this.gizmo.setTranslationSnap(this.objectSnapEnabled && prop && this.selectedPoint < 0 ? null : step || null); this.gizmo.setRotationSnap(step ? T.MathUtils.degToRad(15) : null); }
    setObjectSnap(enabled: boolean) { this.objectSnapEnabled = enabled; this.objectSnapTarget = ''; this.snapTargets = null; this.setPlacementSnap(this.placementSnap); }
    snapPosition(position: Vec3): Vec3 { return this.placementSnap ? position.map(v => Math.round(v / this.placementSnap) * this.placementSnap) as Vec3 : [...position]; }
    private collectSnapTargets(exclude: string) {
        const targets: SnapBounds[] = [];
        for (const entity of this.project.entities) {
            if (entity.id === exclude || entity.kind !== 'prop' || entity.light || !editorEntityVisible(this.project, entity)) continue;
            const root = this.models.get(entity.id);
            const bounds = root ? objectBounds(root, entity.id, entity.name) : null;
            if (bounds) targets.push(bounds);
        }
        if (this.project.room.enabled) {
            const names: Record<string, string> = { north: '北墙', south: '南墙', east: '东墙', west: '西墙', ceiling: '天花板' };
            for (const [side, wall] of this.walls) {
                if (this.project.editorView?.hideWalls) continue;
                const bounds = objectBounds(wall, 'room-' + side, names[side]); if (bounds) targets.push(bounds);
            }
            const floor = this.roomGroup.children.find(o => o instanceof T.Mesh);
            if (floor) { const bounds = objectBounds(floor, 'room-floor', '房间地面'); if (bounds) targets.push(bounds); }
        }
        return targets;
    }
    snapObjectPosition(id: string, position: Vec3, axes = 'XYZ'): Vec3 {
        const entity = this.project.entities.find(e => e.id === id), root = this.models.get(id);
        if (!this.objectSnapEnabled || entity?.kind !== 'prop' || !root || this.selectedPoint >= 0) return position;
        const bounds = objectBounds(root, id, entity.name); if (!bounds) return position;
        const delta = new T.Vector3(...position).sub(root.position);
        bounds.corners.forEach(p => p.add(delta));
        const targets = this.dragging ? (this.snapTargets ??= this.collectSnapTargets(id)) : this.collectSnapTargets(id);
        const result = findObjectSnap(bounds, targets, axes);
        this.objectSnapTarget = result?.target.name ?? '';
        if (result && result.offset.lengthSq() > 1e-12) return new T.Vector3(...position).add(result.offset).toArray() as Vec3;
        // Nearby object boundaries win over the grid. Otherwise retain grid behavior on active axes only.
        const grid = new T.Vector3(...position.map((v, i) => axes.includes('XYZ'[i]) && this.placementSnap ? Math.round(v / this.placementSnap) * this.placementSnap : v));
        if (result) {
            const correction = grid.sub(new T.Vector3(...position));
            const normal = result.normal.clone();
            ['X', 'Y', 'Z'].forEach((axis, i) => { if (!axes.includes(axis)) normal.setComponent(i, 0); });
            if (normal.lengthSq() > 1e-8) correction.addScaledVector(normal, -correction.dot(result.normal) / normal.lengthSq());
            return new T.Vector3(...position).add(correction).toArray() as Vec3;
        }
        return grid.toArray() as Vec3;
    }
    refreshHelpers() {
        this.needsRender = true;
        this.contactMarker.root?.removeFromParent();
        while (this.helpers.children.length)
            disposeTree(this.helpers.children[0]);
        while (this.pathHelpers.children.length)
            disposeTree(this.pathHelpers.children[0]);
        this.selectionBox = null;
        if (this.contactMarker.root) this.helpers.add(this.contactMarker.root);
        const grid = new T.GridHelper(this.project.room.enabled ? 20 : 80, this.project.room.enabled ? 20 : 80, '#6b777e', '#717a7d');
        grid.position.y = workingElevation(this.project) + .004;
        grid.visible = this.gridVisible;
        grid.material.transparent = true;
        grid.material.opacity = .24;
        this.helpers.add(grid);
        addZoneHelpers(this.helpers, this.project.zones ?? []);
        const e = this.project.entities.find(x => x.id === this.selected);
        if (e && editorEntityVisible(this.project, e)) {
            const root = this.models.get(e.id);
            if (root && e.kind !== 'camera') {
                this.selectionBox = new T.BoxHelper(root, '#a6c5e5');
                this.helpers.add(this.selectionBox);
            }
            if (e.path) {
                const pts: T.Vector3[] = [];
                const first = e.path.points[0].time, last = e.path.points.at(-1)!.time;
                for (let i = 0; i <= 100; i++)
                    pts.push(pathPosition({smooth:e.path.smooth,interpolation:e.path.interpolation,points:e.path.points}, e.position, first + (last - first) * i / 100).add(new T.Vector3(0, .016, 0)));
                const line = new T.Line(new T.BufferGeometry().setFromPoints(pts), new T.LineBasicMaterial({ color: e.kind === 'camera' ? '#e3d7bd' : e.color }));
                this.pathHelpers.add(line);
                e.path.points.forEach((p, i) => { const point = new T.Mesh(new T.SphereGeometry(.055, 12, 8), new T.MeshBasicMaterial({ color: i === this.selectedPoint ? '#ffffff' : '#87add9', depthTest: false })); point.position.fromArray(p.position); point.position.y += .025; point.userData.pointIndex = i; point.userData.entityId = e.id; point.renderOrder = 3; this.pathHelpers.add(point); });
            }
            if (e.kind === 'camera') {
                const helper = new T.CameraHelper(this.cameras.get(e.id)!);
                const tint = new T.Color('#9eafc1');
                helper.setColors(tint, tint, tint, tint, tint);
                this.helpers.add(helper);
            }
        }
        this.helpers.traverse(o => o.layers.set(1));
        this.pathHelpers.traverse(o => o.layers.set(1));
    }
    private prepareView(editor: boolean, id = this.previewId) {
        const cameraEntity = this.cameraEntity(id);
        for (const e of this.project.entities) {
            const root = this.models.get(e.id); if (!root) continue;
            root.visible = (editor ? editorEntityVisible(this.project, e) : shotEntityVisible(this.project, e, cameraEntity.camera)) && (!e.visual || this.time>=e.visual.start&&(!e.visual.end||this.time<e.visual.end));
        }
        this.contactMarker.update(this.project.entities, this.models);
        const room = this.project.room;
        this.roomGroup.visible = room.enabled;
        for (const [side, wall] of this.walls) {
            wall.visible = editor ? !this.project.editorView?.hideWalls && side !== 'ceiling' && !(side === 'south' && this.editorCamera.position.z > room.depth / 2) && !(side === 'north' && this.editorCamera.position.z < -room.depth / 2) && !(side === 'east' && this.editorCamera.position.x > room.width / 2) && !(side === 'west' && this.editorCamera.position.x < -room.width / 2) : !cameraEntity.camera!.hideWalls.includes(side);
        }
        this.rigs.forEach(r => r.head.visible = true);
        if (!editor && cameraEntity.camera!.mode === 'pov') {
            const rig = this.rigs.get(cameraEntity.camera!.targetId);
            if (rig)
                rig.head.visible = false;
        }
        this.scene.background = new T.Color(editor ? '#252a2d' : this.project.lighting?.background ?? '#c6c8c6');
    }
    resize() {
        const ratio = Math.min(window.devicePixelRatio, 1.5) * (this.previewQuality === 'draft' ? .65 : 1);
        this.editorRenderer.setPixelRatio(ratio); this.shotRenderer.setPixelRatio(ratio);
        const sw = this.stage.clientWidth, sh = this.stage.clientHeight;
        if (sw && sh) {
            this.editorRenderer.setSize(sw, sh);
            this.editorCamera.aspect = sw / sh;
            this.editorCamera.updateProjectionMatrix();
        }
        const bw = this.shot.clientWidth, bh = this.shot.clientHeight, a = aspectNumber(this.project.aspect);
        if (bw && bh) {
            const w = Math.round(Math.min(bw, bh * a)), h = Math.round(w / a);
            this.shotRenderer.setSize(w, h);
        }
        this.resizeNeeded = false;
    }
    render(force = true) {
        if (this.exporting || this.disposed)
            return;
        this.orbit.update();
        const view = `${this.previewId}:${this.gridVisible}:${this.drawingPath}:${this.positionKeying}:${this.objectSnapEnabled}:${this.objectSnapTarget}`;
        if (!force && !this.needsRender && !this.resizeNeeded && view === this.renderedView) return;
        this.needsRender = false; this.renderedView = view;
        if (this.resizeNeeded)
            this.resize();
        this.helpers.traverse(o => { if (o instanceof T.CameraHelper)
            o.update(); });
        this.surfaces.textures.maxEdge=this.previewQuality==='draft'&&!this.exporting?1024:2048;
        this.surfaces.sample(this.project,this.models,this.time);
        this.prepareView(true);
        if (this.stage.clientWidth)
            this.editorRenderer.render(this.scene, this.editorCamera);
        this.prepareView(false);
        if (this.shot.clientWidth) {
            this.renderShot(this.previewId);
        }
        this.onFrame();
    }
    renderOutput(time: number, width: number, height: number, cameraId = 'program') {
        this.sample(time);
        this.shotRenderer.setPixelRatio(1);
        this.shotRenderer.setSize(width, height, false);
        // Same physical gate as preview. Integer output pixels only affect resolution, never camera framing.
        this.prepareView(false, cameraId);
        this.renderShot(cameraId);
        return this.shotRenderer.domElement;
    }
    private renderReferenceLabels(camera: T.PerspectiveCamera, id: string) {
        const settings = this.cameraEntity(id).camera!;
        this.referenceLabels.render(this.shotRenderer, camera, this.project, this.models, key => this.rigs.get(key)?.head,
            settings.mode === 'pov' ? settings.targetId : '');
    }
    restorePreview(time: number) { this.exporting = false; this.sample(time); this.shotRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); this.resizeNeeded = true; this.render(); }
    requestResize() { this.resizeNeeded = true; }
    viewTop() { const y = workingElevation(this.project); this.editorCamera.position.set(0, y + 10, .001); this.orbit.target.set(0, y, 0); this.orbit.update(); }
    viewHome() { const distance = this.project.room.enabled ? 7 : 18, y = workingElevation(this.project); this.editorCamera.position.set(distance, distance * .84 + y, distance); this.orbit.target.set(0, y + .85, 0); this.orbit.update(); }
    focus(id: string) {
        const target = this.models.get(id); if (!target) return;
        this.focusBounds(new T.Box3().setFromObject(target));
    }
    private renderShot(id: string) {
        const camera = this.getShotCamera(id), effects = this.cameraEntity(id).camera!.effects;
        const focusTarget = effects?.focusTargetId ? this.models.get(effects.focusTargetId)?.getWorldPosition(new T.Vector3()) : undefined;
        this.shotEffects.render(this.shotRenderer, this.scene, camera, effects, this.time, cameraFocusDistance(camera, effects, this.time, focusTarget), cam => this.renderReferenceLabels(cam, id),collectWarps(this.project.entities,this.models,camera,this.time));
    }
    focusBounds(bounds: T.Box3) {
        if (bounds.isEmpty()) return;
        const size = bounds.getSize(new T.Vector3());
        bounds.getCenter(this.orbit.target);
        const distance = Math.max(1.5, size.length() / (2 * Math.tan(T.MathUtils.degToRad(this.editorCamera.fov / 2))) / Math.min(1, this.editorCamera.aspect));
        const direction = this.editorCamera.position.clone().sub(this.orbit.target).normalize();
        if (direction.lengthSq() < .01) direction.set(1, .7, 1).normalize();
        this.editorCamera.position.copy(this.orbit.target).addScaledVector(direction, distance * 1.2); this.orbit.update();
    }
    pick(e: PointerEvent) {
        if (!this.pickingEnabled || e.button !== 0 || this.dragging || this.gizmo.axis || Math.hypot(e.clientX - this.pointerDown[0], e.clientY - this.pointerDown[1]) > 5)
            return;
        const rect = this.editorRenderer.domElement.getBoundingClientRect();
        const mouse = new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
        const ray = new T.Raycaster();
        ray.layers.enable(1);
        ray.setFromCamera(mouse, this.editorCamera);
        this.prepareView(true);
        try {
        if (this.drawingPath) {
            if (this.pathSurfaceMode === 'surface') {
                const surfaces: T.Object3D[] = this.project.entities.filter(item => item.kind === 'prop' && !item.light && item.visible && item.id !== this.selected).map(item => this.models.get(item.id)!);
                if (this.project.room.enabled) surfaces.push(this.roomGroup);
                const surface = ray.intersectObjects(surfaces, true).find(hit => {
                    let node: T.Object3D | null = hit.object;
                    while (node) { if (!node.visible) return false; node = node.parent; }
                    return true;
                });
                if (surface) { this.cb.ground(surface.point.toArray() as Vec3); return; }
            }
            const out = new T.Vector3();
            if (ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -workingElevation(this.project)), out))
                this.cb.ground(out.toArray() as Vec3);
            return;
        }
        const points = ray.intersectObjects(this.pathHelpers.children, false).find(x => x.object.userData.pointIndex !== undefined);
        if (points) {
            this.cb.point(points.object.userData.pointIndex);
            return;
        }
        const hit = ray.intersectObjects([...this.models.values()], true).find(x => { let o: T.Object3D | null = x.object; while (o) {
            if (!o.visible)
                return false;
            o = o.parent;
        } return true; });
        if (hit)
            this.cb.select(hit.object.userData.entityId);
        } finally { this.prepareView(false); }
    }
    getProjectedLabels() {
        const w = this.stage.clientWidth, h = this.stage.clientHeight;
        return this.project.entities.filter(e => editorEntityVisible(this.project, e) && (e.kind === 'actor' || e.kind === 'camera')).map(e => { const p = this.models.get(e.id)!.position.clone().add(new T.Vector3(0, e.kind === 'actor' ? e.height + .16 : .25, 0)); p.project(this.editorCamera); return { id: e.id, name: e.name.split(' · ')[0], color: e.color, x: (p.x * .5 + .5) * w, y: (-.5 * p.y + .5) * h, visible: p.z >= -1 && p.z <= 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1 }; });
    }
    projectionSignature(id = this.previewId) { const c = this.getShotCamera(id); return { cameraId: this.cameraEntity(id).id, time: this.time, world: c.matrixWorld.toArray(), projection: c.projectionMatrix.toArray() }; }
    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.events.abort(); this.resizeObserver.disconnect();
        this.gizmo.detach(); this.gizmo.dispose(); this.orbit.dispose();
        this.surfaces.dispose();this.deformations.dispose();for(const root of this.models.values())disposeVisual(root);
        this.referenceLabels.clear(); this.shotEffects.dispose(); this.lighting.dispose();
        for (const [id, root] of this.models) {
            if (!this.externalModels.removeInstance(id, this.crowdRigs.get(id)?.map((_, i) => `${id}:${i}`))) disposeTree(root);
        }
        this.externalModels.dispose(); this.models.clear(); this.cameras.clear(); this.rigs.clear(); this.crowdRigs.clear(); this.cameraVisuals.clear();
        disposeTree(this.roomGroup); disposeTree(this.helpers); disposeTree(this.pathHelpers); this.selectionBox?.dispose();
        this.scene.clear();
        for (const renderer of [this.editorRenderer, this.shotRenderer]) { renderer.dispose(); renderer.domElement.remove(); }
    }
}
