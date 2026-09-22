import * as T from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { Entity } from '../model.ts';

/** Planar views deliberately exclude one another: bounded cost, no recursive hall of mirrors. */
export function makePlanarView(e: Entity): T.Mesh {
    const mirror = e.visual!.preset === 'mirror';
    const resolution = e.visual!.quality === 'draft' ? 512 : e.visual!.quality === 'high' ? 2048 : 1024;
    const geometry = new T.PlaneGeometry(4, 4);
    const target = mirror ? null : new T.WebGLRenderTarget(resolution, resolution);
    const mesh = mirror
        ? new Reflector(geometry, { textureWidth: resolution, textureHeight: resolution, multisample: 0, color: e.color })
        : new T.Mesh(geometry, new T.MeshBasicMaterial({ color:e.color,map: target!.texture, side: T.DoubleSide }));
    mesh.userData.planarView = true;
    if(mirror){
        const material=mesh.material as T.ShaderMaterial;
        material.uniforms.visualOpacity={value:1};
        material.fragmentShader='uniform float visualOpacity;\n'+material.fragmentShader.replace('gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );','gl_FragColor = vec4( blendOverlay( base.rgb, color ), visualOpacity );');
    }
    mesh.userData.disposePlanar = () => { if (mirror) (mesh as Reflector).getRenderTarget().dispose(); else target!.dispose(); };
    const reflect = mesh.onBeforeRender;
    const viewport = new T.Vector4(), scissor = new T.Vector4();
    let rendering = false;
    mesh.onBeforeRender = function(renderer, scene, camera, geometry, material, group) {
        if (rendering) return;
        const destination = this.userData.portalCamera as T.PerspectiveCamera | undefined;
        if (!mirror && !destination) return;
        const hidden: T.Object3D[] = [];
        scene.traverse(o => { if (o.userData.planarView && o.visible) { hidden.push(o); o.visible = false; } });
        const previous = renderer.getRenderTarget(), xr = renderer.xr.enabled, shadows = renderer.shadowMap.autoUpdate, scissorTest = renderer.getScissorTest();
        renderer.getViewport(viewport); renderer.getScissor(scissor); rendering = true;
        try {
            if (mirror) reflect.call(this, renderer, scene, camera, geometry, material, group);
            else {
                renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
                renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.clear(); renderer.render(scene, destination!);
            }
        } finally {
            renderer.xr.enabled = xr; renderer.shadowMap.autoUpdate = shadows;
            renderer.setRenderTarget(previous); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
            hidden.forEach(o => { o.visible = true; }); rendering = false;
        }
    };
    return mesh;
}
