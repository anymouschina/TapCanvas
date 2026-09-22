import { ArrowHelper, Box3, Color, DirectionalLight, FogExp2, Group, HemisphereLight, Light, Mesh, MeshBasicMaterial, PointLight, RectAreaLight, Scene, SphereGeometry, SpotLight, Vector3, WebGLRenderer } from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { setWallTransmission } from './wall-transmission.ts';
import type { Entity } from '../model.ts';
import { eased, numberAt } from '../animation/channels.ts';
import { defaultLighting, lightIntensity, type LightConfig, type LightingConfig } from './model.ts';
let areaReady = false;
function temperatureColor(kelvin: number) {
    const t = kelvin / 100, clamp = (v: number) => Math.max(0, Math.min(255, v)) / 255;
    return new Color().setRGB(clamp(t <= 66 ? 255 : 329.698727446 * (t - 60) ** -.1332047592), clamp(t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -.0755148492), clamp(t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307), 'srgb');
}
export function lightColor(entity: Entity, time: number) {
    const light = entity.light!, keys = light.colorKeys ?? [];
    let result = new Color(entity.color);
    if (keys.length) {
        result.set(keys[0].color);
        for (let i = 1; i < keys.length; i++) {
            const a = keys[i - 1], b = keys[i];
            if (time < b.time) { result.set(a.color).lerp(new Color(b.color), eased((time - a.time) / (b.time - a.time), b.easing)); break; }
            result.set(b.color);
        }
    }
    if (light.temperature !== undefined) result.multiply(temperatureColor(numberAt(light.temperature, time, 6500)));
    return result;
}
export function makeLight(entity: Entity) {
    const root = new Group(), config = entity.light!;
    if (entity.asset === 'light-area' && !areaReady) { RectAreaLightUniformsLib.init(); areaReady = true; }
    const light = entity.asset === 'light-sun' ? new DirectionalLight() : entity.asset === 'light-spot' ? new SpotLight() : entity.asset === 'light-area' ? new RectAreaLight() : new PointLight();
    light.name = 'director-light'; root.add(light);
    if (light instanceof SpotLight || light instanceof DirectionalLight) { light.target.position.set(0, 0, -1); root.add(light.target); }
    const marker = new Mesh(new SphereGeometry(.18, 10, 8), new MeshBasicMaterial({ color: entity.color, wireframe: true, toneMapped: false }));
    marker.layers.set(1); root.add(marker); root.userData.lightMarker = marker;
    if (entity.asset !== 'light-point') { const arrow = new ArrowHelper(new Vector3(0, 0, -1), new Vector3(), .8, entity.color); arrow.traverse(o => o.layers.set(1)); root.add(arrow); }
    updateLight(light, config, entity, 0, 'medium'); return root;
}
function updateLight(light: Light, config: LightConfig, entity: Entity, time: number, quality: LightingConfig['quality']) {
    light.intensity = lightIntensity(config, time); light.color.copy(lightColor(entity, time));
    if (light instanceof PointLight || light instanceof SpotLight) { light.distance = config.range; light.decay = 2; }
    if (light instanceof SpotLight) { light.angle = config.angle * Math.PI / 180; light.penumbra = config.penumbra; }
    if (light instanceof RectAreaLight) { light.width = config.width; light.height = config.height; }
    if (light instanceof DirectionalLight) {
        light.shadow.camera.left = light.shadow.camera.bottom = -config.range / 2; light.shadow.camera.right = light.shadow.camera.top = config.range / 2;
        light.shadow.camera.far = config.range * 4; light.shadow.camera.updateProjectionMatrix();
    }
    if (light instanceof DirectionalLight || light instanceof PointLight || light instanceof SpotLight) {
        setWallTransmission(light.shadow.camera, config.throughWalls === true);
        const size = quality === 'high' ? 4096 : quality === 'low' ? 512 : 2048;
        if (light.shadow.mapSize.x !== size) { light.shadow.map?.dispose(); light.shadow.map = null; light.shadow.mapSize.set(size, size); }
        light.castShadow = config.shadows && quality !== 'off'; light.shadow.normalBias = .025; light.shadow.bias = -.0001;
        if (light instanceof PointLight || light instanceof SpotLight) light.shadow.camera.far = config.range;
    }
}
export class SceneLighting {
    private bounds = new WeakMap<Group, Box3>();
    private worldBounds = new Box3();
    private objectBounds = new Box3();
    private center = new Vector3();
    private size = new Vector3();
    private ambient = new HemisphereLight('#ffffff', '#88847e', 2.5);
    private sun = new DirectionalLight('#fff7e9', 3.5);
    private fill = new DirectionalLight('#d6e4f7', 1.1);
    private fog = new FogExp2('#c6c8c6', 0);
    constructor(scene: Scene) {
        this.sun.position.set(-3.7, 7, 4); this.fill.position.set(4, 3, -1); this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.left = this.sun.shadow.camera.bottom = -7; this.sun.shadow.camera.right = this.sun.shadow.camera.top = 7;
        this.sun.shadow.normalBias = .025; this.sun.shadow.bias = -.0001;
        scene.add(this.ambient, this.sun, this.sun.target, this.fill);
    }
    sample(scene: Scene, value: LightingConfig | undefined, entities: Entity[], models: Map<string, Group>, time: number, renderers: WebGLRenderer[]) {
        const config = value ?? defaultLighting();
        this.ambient.intensity = numberAt(config.ambient, time); this.ambient.groundColor.set(config.groundColor);
        this.sun.visible = this.fill.visible = config.defaultLights;
        this.sun.color.set(config.sunColor ?? '#fff7e9'); this.sun.intensity = numberAt(config.sunIntensity, time, 3.5);
        this.fill.intensity = config.sunColor ? Math.min(.25, this.ambient.intensity * .3) : 1.1;
        const size = config.quality === 'high' ? 4096 : config.quality === 'low' ? 512 : 2048;
        if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; this.sun.shadow.mapSize.set(size, size); }
        for (const renderer of renderers) { renderer.toneMappingExposure = numberAt(config.exposure, time); renderer.shadowMap.enabled = config.quality !== 'off'; }
        if (value) {
            // Cache each model's local extent; moving instances only transform eight corners, never traverse geometry per frame.
            this.worldBounds.makeEmpty();
            for (const entity of entities) {
                if (!entity.visible || entity.camera || entity.light) continue;
                const root = models.get(entity.id); if (!root) continue;
                let local = this.bounds.get(root);
                if (!local) { local = new Box3().setFromObject(root).applyMatrix4(root.matrixWorld.clone().invert()); this.bounds.set(root, local); }
                this.objectBounds.copy(local).applyMatrix4(root.matrixWorld);
                if (entity.kind === 'actor' || entity.kind === 'crowd') this.objectBounds.expandByScalar(entity.height);
                this.worldBounds.union(this.objectBounds);
            }
            const center = this.worldBounds.isEmpty() ? this.center.set(0, 0, 0) : this.worldBounds.getCenter(this.center);
            const radius = Math.max(7, this.worldBounds.getSize(this.size).length() / 2 + 2);
            this.sun.target.position.copy(center); this.sun.position.copy(center).add(new Vector3(...(config.sunDirection ?? [-3.7, 7, 4])).normalize().multiplyScalar(radius * 2));
            const cam = this.sun.shadow.camera; cam.left = cam.bottom = -radius; cam.right = cam.top = radius; cam.far = radius * 5; cam.updateProjectionMatrix();
        } else { this.sun.position.set(-3.7, 7, 4); this.sun.target.position.set(0, 0, 0); const cam = this.sun.shadow.camera; cam.left = cam.bottom = -7; cam.right = cam.top = 7; cam.far = 500; cam.updateProjectionMatrix(); }
        this.sun.target.updateMatrixWorld();
        if (config.fog) { this.fog.color.set(config.fog.color); this.fog.density = numberAt(config.fog.density, time); scene.fog = this.fog; } else scene.fog = null;
        for (const entity of entities) if (entity.light) {
            const light = models.get(entity.id)?.getObjectByName('director-light');
            if (light instanceof Light) updateLight(light, entity.light, entity, time, config.quality);
        }
    }
    dispose() { for (const light of [this.sun, this.fill, this.ambient]) { light.dispose(); light.removeFromParent(); } this.sun.target.removeFromParent(); }
}
