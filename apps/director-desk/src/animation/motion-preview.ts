import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ModelMotion } from '../resources/model-motion.ts';
import type { LoadedModel } from '../resources/model-runtime.ts';
import type { UserMotion } from './user-motion.ts';

/** Disposable source preview. Never samples or edits the production renderer. */
export class MotionPreview {
    private renderer = new T.WebGLRenderer({ antialias: true });
    private scene = new T.Scene();
    private camera = new T.PerspectiveCamera(40, 1, .01, 10000);
    private controls: OrbitControls;
    private instance;
    private motion;
    private skeleton;
    private grid = new T.GridHelper(10, 20, '#555555', '#333333');
    private frame = 0;
    private elapsed = 0;
    private previous = 0;
    private width = 0;
    private height = 0;
    playing = true;
    constructor(private host: HTMLElement, model: LoadedModel, private entry: UserMotion) {
        this.instance = model.instantiate(); this.motion = new ModelMotion(this.instance);
        this.instance.root.scale.setScalar(entry.data.unitScale); this.instance.root.rotation.set(...entry.data.orientation);
        this.instance.setAppearance('white'); this.skeleton = new T.SkeletonHelper(this.instance.root);
        (this.skeleton.material as T.Material).depthTest = false;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); this.renderer.setClearColor('#151515');
        host.replaceChildren(this.renderer.domElement);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
        this.scene.add(this.motion.root, this.skeleton, this.grid, new T.HemisphereLight('#ffffff', '#777777', 2.5));
        const sun = new T.DirectionalLight('#ffffff', 3); sun.position.set(3, 5, 4); this.scene.add(sun);
        const bounds = model.inspection.bounds;
        const height = Math.max(.2, bounds.max[1] - bounds.min[1]) * entry.data.unitScale;
        this.controls.target.set(0, (bounds.min[1] + bounds.max[1]) * .5 * entry.data.unitScale, 0);
        this.camera.position.copy(this.controls.target).add(new T.Vector3(height * 1.5, height * .5, height * 2));
        this.frame = requestAnimationFrame(time => this.tick(time));
    }
    private tick(time: number) {
        if (this.previous && this.playing) this.elapsed += Math.min(.1, (time - this.previous) / 1000);
        this.previous = time;
        const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
        if (width !== this.width || height !== this.height) {
            this.width = width; this.height = height;
            this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
        }
        this.motion.sample(this.entry.data.index, this.elapsed % this.entry.duration, false, this.entry.data.motion);
        this.controls.update(); this.renderer.render(this.scene, this.camera);
        this.frame = requestAnimationFrame(t => this.tick(t));
    }
    dispose() {
        cancelAnimationFrame(this.frame); this.controls.dispose(); this.instance.dispose();
        this.skeleton.dispose(); this.grid.geometry.dispose(); (this.grid.material as T.Material).dispose();
        this.renderer.dispose(); this.renderer.forceContextLoss(); this.host.replaceChildren();
    }
}
