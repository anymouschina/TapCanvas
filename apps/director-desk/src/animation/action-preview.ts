import * as T from 'three';
import { entity, clip, type Action } from '../model.ts';
import { makeActor, animateActor } from '../assets/actors.ts';
import { disposeTree } from '../assets/dispose.ts';

/** One mannequin and renderer per open picker, independent of the scene clock. */
export class ActionPreview {
    private renderer = new T.WebGLRenderer({ antialias: true });
    private scene = new T.Scene();
    private camera = new T.PerspectiveCamera(40, 1, .01, 50);
    private model = entity('actor', 'human-adult', '动作预览');
    private rig;
    private frame = 0;
    private width = 0; private height = 0; private disposed = false;
    private lastFrame = 0;
    private start = performance.now();
    constructor(private host: HTMLElement) {
        this.model.color = '#dddddd'; this.rig = makeActor(this.model);
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.renderer.setClearColor('#202020'); host.replaceChildren(this.renderer.domElement);
        this.scene.add(this.rig.root, new T.HemisphereLight('#ffffff', '#777777', 2.5));
        const light = new T.DirectionalLight('#ffffff', 2); light.position.set(3, 5, 4); this.scene.add(light);
        this.camera.position.set(2.5, 1.8, 3.5); this.camera.lookAt(0, .8, 0);
        const tick = (now: number) => {
            if (!host.isConnected) { this.dispose(); return; }
            if (now-this.lastFrame < 1000/30) { this.frame = requestAnimationFrame(tick); return; }
            this.lastFrame = now;
            const w = Math.max(1,host.clientWidth), h = Math.max(1,host.clientHeight);
            if (this.width !== w || this.height !== h) {
                this.width = w; this.height = h; this.renderer.setSize(w,h,false); this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
            }
            animateActor(this.rig,this.model,(now-this.start)/1000 % 4);
            this.renderer.render(this.scene,this.camera); this.frame = requestAnimationFrame(tick);
        };
        this.frame = requestAnimationFrame(tick);
    }
    set(action: Action) { this.model.clips = [clip(action,0,4)]; this.start = performance.now(); }
    dispose() { if (this.disposed) return; this.disposed = true; cancelAnimationFrame(this.frame); disposeTree(this.rig.root); this.renderer.dispose(); this.renderer.forceContextLoss(); this.host.replaceChildren(); }
}
