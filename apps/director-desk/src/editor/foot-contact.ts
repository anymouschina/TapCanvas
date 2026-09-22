import * as T from 'three';
import type { Rig } from '../assets.ts';
/** Two-bone sagittal leg solve. Targets are in rig units, so mannequin height is preserved. */
export function legAngles(down:number,forward:number,upper=.43,lower=.458) {
 const d=T.MathUtils.clamp(Math.hypot(down,forward),.03,upper+lower-.000001);
 return {hip:Math.atan2(-forward,down)-Math.acos(T.MathUtils.clamp((upper*upper+d*d-lower*lower)/(2*upper*d),-1,1)),knee:Math.PI-Math.acos(T.MathUtils.clamp((upper*upper+lower*lower-d*d)/(2*upper*lower),-1,1))};
}
export function fitFeetToSurface(r:Rig,surface:(x:number,y:number,z:number)=>number|null) {
 r.root.updateWorldMatrix(true,true);
 const scale=r.root.getWorldScale(new T.Vector3()).y;
 for(const side of ['left','right']){
  const hip=r.joints[side+'Hip'],knee=r.joints[side+'Knee'],ankle=r.joints[side+'Ankle'];
  const foot=ankle.getWorldPosition(new T.Vector3()),height=surface(foot.x,r.root.getWorldPosition(new T.Vector3()).y+.55*scale,foot.z);
  if(height===null)continue;
  // Keep the swing-foot lift; raise a penetrating sole onto the support surface.
  foot.y=Math.max(foot.y,height+.037*scale);
  const target=r.hips.worldToLocal(foot).sub(hip.position);
  const angles=legAngles(-target.y,target.z,r.legLengths?.upper,r.legLengths?.lower);
  hip.rotation.x=angles.hip;knee.rotation.x=angles.knee;
  ankle.rotation.x=-angles.hip-angles.knee-r.hips.rotation.x;
 }
 r.root.updateWorldMatrix(true,true);
}
