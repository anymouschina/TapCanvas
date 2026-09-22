import {warpShader,type WarpSample} from '../visuals/warps.ts';
import { Vector4, DepthTexture, HalfFloatType, Mesh, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, UnsignedIntType, Vector2, WebGLRenderer, WebGLRenderTarget } from 'three';
import { numberAt } from '../animation/channels.ts';
import type { CameraEffects } from './camera-effects.ts';
import { lensOverscan, lensProjection, overscanCamera } from './lens-projection.ts';
const fragmentShader = `
uniform sampler2D image; uniform sampler2D depthMap;
uniform float nearPlane; uniform float farPlane;
uniform float focus; uniform float blur; uniform float bloom;
uniform float aspect; uniform float distortion; uniform int distortionType; uniform float overscan;
varying vec2 vUv;
${warpShader}
float viewDepth(vec2 uv){ float d=texture2D(depthMap,uv).x; return nearPlane*farPlane/(farPlane-(farPlane-nearPlane)*d); }
void main(){
 vec2 q=vUv*2.-1.; float r=length(vec2(q.x*aspect,q.y))/length(vec2(aspect,1.));
 float k=distortion*.6; float factor=1.;
 if(distortionType==0) factor=1.+k*r*r;
 else if(distortionType==1) factor=1./(1.+k*r*r);
 else if(distortion>.000001 && r>.000001) factor=tan(r*distortion*.9)/(r*distortion*.9);
 vec2 uv=warpedUv((q*factor/overscan+1.)*.5);
 vec3 color=texture2D(image,uv).rgb;
 if(blur>0.) {
   float z=viewDepth(uv); float radius=clamp(abs(z-focus)/max(z,.05),0.,1.)*blur*.016;
   vec3 sum=color; float count=1.;
   for(int i=0;i<24;i++) {
     float a=float(i)*2.399963; float ring=sqrt((float(i)+.5)/24.);
     vec2 at=clamp(uv+vec2(cos(a)/aspect,sin(a))*ring*radius,.001,.999);
     float dz=viewDepth(at); float accept=dz<z*.9 && abs(dz-focus)<abs(z-focus)*.5 ? .1:1.;
     sum+=texture2D(image,at).rgb*accept; count+=accept;
   }
   color=sum/count;
 }
 if(bloom>0.) {
   vec3 glow=vec3(0.);
   for(int i=0;i<16;i++) {
     float a=float(i)*2.399963; float ring=sqrt((float(i)+.5)/16.);
     vec3 c=texture2D(image,clamp(uv+vec2(cos(a)/aspect,sin(a))*ring*.024,.001,.999)).rgb;
     glow+=max(c-vec3(1.),vec3(0.));
   }
   color+=glow*bloom/16.;
 }
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 if(texture2D(depthMap,uv).x>=.9999999) gl_FragColor.rgb=color;
 #include <colorspace_fragment>
}`;

/** One reusable HDR target and one pass; old/default shots bypass it entirely. */
export class ShotEffects {
    private target?: WebGLRenderTarget;
    private camera = new PerspectiveCamera();
    private scene = new Scene();
    private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private material = new ShaderMaterial({ depthTest: false, depthWrite: false, uniforms: {
        warpCount:{value:0},warpRegions:{value:Array.from({length:8},()=>new Vector4())},warpSettings:{value:Array.from({length:8},()=>new Vector4())},
        image: { value: null }, depthMap: { value: null }, nearPlane: { value: .025 }, farPlane: { value: 2000 },
        focus: { value: 5 }, blur: { value: 0 }, bloom: { value: 0 }, aspect: { value: 1 }, distortion: { value: 0 }, distortionType: { value: 0 }, overscan: { value: 1 },
    }, vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}', fragmentShader });
    private quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    constructor() { this.scene.add(this.quad); }
    render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, effects: CameraEffects | undefined, time: number, focus: number, labels: (camera: PerspectiveCamera) => void,warps:WarpSample[] = []) {
        const blur = numberAt(effects?.channels?.blur, time), bloom = numberAt(effects?.channels?.bloom, time), lens = lensProjection(camera);
        if (!blur && !bloom && !lens && !warps.length) { renderer.render(scene, camera); labels(camera); return; }
        const size = renderer.getDrawingBufferSize(new Vector2());
        if (!this.target) this.target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, depthTexture: new DepthTexture(size.x, size.y, UnsignedIntType), samples: 4 });
        this.target.setSize(size.x, size.y);
        const overscan = lensOverscan(lens), shot = overscanCamera(camera, overscan, this.camera), u = this.material.uniforms;
        u.warpCount.value=warps.length;warps.forEach((w,i)=>{
            const region=u.warpRegions.value[i];region.copy(w.region);
            // Regions and sampled color must use the same overscanned render target coordinates.
            region.x=(region.x-.5)/overscan+.5;region.y=(region.y-.5)/overscan+.5;region.z/=overscan;
            u.warpSettings.value[i].copy(w.settings);
        });
        u.image.value = this.target.texture; u.depthMap.value = this.target.depthTexture;
        u.nearPlane.value = camera.near; u.farPlane.value = camera.far; u.focus.value = focus; u.blur.value = blur; u.bloom.value = bloom;
        u.aspect.value = camera.aspect; u.distortion.value = lens?.amount ?? 0; u.distortionType.value = lens?.type === 'pincushion' ? 1 : lens?.type === 'fisheye' ? 2 : 0; u.overscan.value = overscan;
        const previous = renderer.getRenderTarget(), autoReset = renderer.info.autoReset;
        try {
            renderer.setRenderTarget(this.target); renderer.render(scene, shot); labels(shot);
            renderer.setRenderTarget(previous); renderer.info.autoReset = false; renderer.render(this.scene, this.quadCamera);
        } finally { renderer.setRenderTarget(previous); renderer.info.autoReset = autoReset; }
    }
    dispose() { this.target?.dispose(); this.target?.depthTexture?.dispose(); this.target = undefined; this.quad.geometry.dispose(); this.material.dispose(); }
}
