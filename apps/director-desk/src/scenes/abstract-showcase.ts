import { demoProject } from '../model.ts';
import { defaultLighting } from '../lighting/model.ts';
import { templateBuilder } from './template-builder.ts';

/** Small editable composition demonstrating shared procedural elements, not a baked animation. */
export function createAbstractShowcase(){
    const p=demoProject();p.name='流光空间';p.duration=10;p.aspect='16:9';p.entities=[];p.cuts=[];p.references=[];p.room.enabled=false;
    p.lighting={...defaultLighting(),defaultLights:false,ambient:.12,background:'#060a18',groundColor:'#11192a',exposure:1};
    const {add,box,light,camera}=templateBuilder(p);
    add('prop','ground','深色地面',[0,0,0],'#121b2c',[4,1,4]);
    const backdrop=add('prop','visual-gradient','渐变背景',[0,4,-7],'#34487c');backdrop.visual!.size=3;backdrop.visual!.secondaryColor='#090b20';
    const membrane=add('prop','visual-membrane','波动薄膜',[-3,2,-3],'#4769ef');membrane.visual!.size=.65;membrane.visual!.amplitude=.4;membrane.visual!.opacity=.45;
    const ring=add('prop','visual-halo','能量环',[0,2.5,-1],'#ffad69');ring.visual!.size=.18;
    const helix=add('prop','visual-helix','螺旋光点',[0,2.5,-1],'#7bdcff');Object.assign(helix.visual!,{count:2200,size:.065,spread:4,amplitude:.2,additive:true});
    const dust=add('prop','visual-dust','漂浮微粒',[0,2,0],'#b8cbff');Object.assign(dust.visual!,{count:1800,size:.035,spread:12,amplitude:.5,opacity:.65});
    const field=add('prop','field-vortex','中心漩涡',[0,2.5,-1],'#9a85fa');Object.assign(field.field!,{radius:4,strength:.3,targets:[dust.id]});
    const twist=box('渐变扭转柱',[3.2,0,-2],[.7,4,.7],'#ba98ff');twist.deform={type:'twist',amount:{keys:[{time:0,value:0},{time:5,value:1.1,easing:'smooth'},{time:10,value:0,easing:'smooth'}]},axis:'y',frequency:2,speed:1,seed:42};
    const glass=add('prop','shape-sphere','折射球',[-2,.6,1],'#b6dfff',[1.4,1.4,1.4]);glass.surface={layers:[],transmission:.85,roughness:.08,ior:1.45};
    const mirror=add('prop','visual-mirror','侧面镜面',[4,2,0],'#b5cee8');mirror.visual!.size=.65;mirror.rotation[1]=-.7;
    const caption=add('prop','visual-text','空间标题',[-2,4.8,-3],'#d2e3ff');caption.visual!.text='流光空间';caption.visual!.size=.8;
    light('light-area','蓝色柔光',[-3,5,3],[0,2,0],'#699bff',6);
    light('light-spot','暖色轮廓',[2,5,-4],[0,1,0],'#ff9e57',240);
    const c=camera('A · 穿行观察',[5,3.4,10],[0,2.3,-1],28);
    c.path={smooth:true,points:[{time:0,position:[5,3.4,10]},{time:5,position:[-2,2.8,7],easing:'smooth'},{time:10,position:[-4,2.4,4],easing:'smooth'}]};
    c.camera!.effects={channels:{bloom:.25,distortion:.08},distortionType:'barrel'};
    p.production={fixedPrompt:'',sceneReferenceIds:[],notes:[{id:'abstract-composition',start:0,end:10,actorId:'',story:'光点在中心缓慢聚散，薄膜起伏，摄影机穿行观察空间层次。',emotion:'神秘、轻盈',dialogue:'',action:'螺旋、漂浮和扭转同时进行。'}]};
    return p;
}
