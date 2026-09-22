import { clip, demoProject, type Project } from '../model.ts';
import { templateBuilder } from './template-builder.ts';
import { defaultLighting } from '../lighting/model.ts';
import { applyCameraMotion } from '../cinematography/motion-presets.ts';

export const FEATURE_SCENES = [
    { id: 'light-stage', name: '光影舞台', type: '特色 · 12 秒', detail: '冷暖三点布光、灯光渐变、环绕与光学变焦' },
    { id: 'dolly-hall', name: '悬疑长廊', type: '特色 · 10 秒', detail: '希区柯克变焦：主体大小稳定，背景空间拉伸' },
    { id: 'neon-chase', name: '夜街追逐', type: '特色 · 10 秒', detail: '双人奔跑、冷暖街灯、手持晃动与广角畸变' },
] as const;
export type FeatureScene = typeof FEATURE_SCENES[number]['id'];

/** Ordinary editable projects: examples use the same paths, lights and lens channels as tools. */
export function createFeatureScene(template: FeatureScene): Project {
    const p = demoProject();
    p.name = FEATURE_SCENES.find(t => t.id === template)!.name;
    p.entities = []; p.cuts = []; p.duration = template === 'light-stage' ? 12 : 10;
    p.room.enabled = false;
    p.lighting = { ...defaultLighting(), defaultLights: false, ambient: .45, background: '#151d2b', groundColor: '#434b60' };
    const {add,box,actor,light,camera}=templateBuilder(p);
    if (template === 'light-stage') {
        const lead = actor('人物 A · 展台', [0,.2,0], '#dbbd90');
        actor('人物 B · 侧台', [3,0,-1.5], '#698fb7').rotation[1] = -.8;
        add('prop','ground','舞台地面',[0,0,0],'#353a45',[1.6,1,1.6]);
        add('prop','cylinder','圆形台座',[0,0,0],'#737b8a',[3,.2,3]);
        box('后景墙', [0,0,-4], [12,5,.25], '#445264');
        for (const x of [-4,-2,2,4]) box('竖向背景板', [x,0,-3.6], [.22,3.8,.22], '#a5b2c3');
        const key = light('light-spot','暖色主光',[-3,4,3],[0,1,0],'#ffcc98',240);
        key.light!.angle=42; key.light!.penumbra=.7;
        light('light-area','蓝色柔光',[3,2.8,2],[0,1,0],'#6baeff',5);
        const rim = light('light-spot','轮廓光 · 播放时变色',[1,3,-2],[0,1,0],'#91bbff',180);
        rim.light!.colorKeys=[{time:0,color:'#91bbff'},{time:6,color:'#ba8aff',easing:'smooth'},{time:12,color:'#ffac75',easing:'smooth'}];
        const orbit=camera('A · 冷暖光环绕',[3.5,2.3,6],[0,1.1,0],32);
        applyCameraMotion(p,orbit.id,'arc',0,6,{angle:45,easing:'smooth'});
        orbit.camera!.effects!.channels={bloom:.12};
        const zoom=camera('B · 固定机位变焦',[-.6,1.6,6.5],[0,1.35,0],32,6);
        zoom.camera!.effects={channels:{focal:{keys:[{time:6,value:32},{time:12,value:90,easing:'smooth'}]},bloom:.12},focusTargetId:lead.id};
    } else if (template === 'dolly-hall') {
        actor('人物 A · 长廊',[0,0,-1],'#d8a878');
        add('prop','ground','长廊地面',[0,0,-3],'#777d88',[.8,1,3.6]);
        box('长廊顶板',[0,4.4,-3],[8,.2,36],'#434959');
        for (const x of [-4,4]) box('长廊侧墙',[x,0,-3],[.25,4.4,36],'#738398');
        for(let i=0;i<9;i++) {
            const z=9-i*3;
            for(const x of [-3.5,3.5]) box('连续立柱',[x,0,z],[.35,4.4,.4],'#b0b9c6');
            box('连续横梁',[0,4.1,z],[7,.3,.4],'#a5afbd');
        }
        light('light-area','正面柔光',[0,3.8,5],[0,1,-1],'#ffcfaa',5);
        light('light-spot','尽头蓝色逆光',[0,3.6,-7],[0,1,-1],'#75adff',280);
        light('light-area','远处环境补光',[0,3,-15],[0,1,-7],'#6699dd',3);
        const c=camera('A · 希区柯克变焦',[0,1.2,3],[0,1.2,-1],25);
        applyCameraMotion(p,c.id,'dolly-zoom',0,10,{amplitude:6,easing:'smooth'});
    } else {
        const runner=actor('人物 A · 奔跑',[-.7,0,9],'#75b799');
        const pursuer=actor('人物 B · 追赶',[.6,0,12],'#526078');
        for(const [e,offset] of [[runner,0],[pursuer,3]] as const) {
            e.clips=[clip('run',0,10)];
            e.path={smooth:true,points:[{time:0,position:[e.position[0],0,9+offset]},{time:3,position:[-.8,0,-1+offset]},{time:6.5,position:[.8,0,-13+offset]},{time:10,position:[-.6,0,-25+offset]}]};
        }
        add('prop','ground','夜街路面',[0,0,-8],'#535c70',[1.2,1,5.4]);
        for(let i=0;i<6;i++) {
            const z=12-i*8;
            for(const x of [-7,7]) box('街道楼体',[x,0,z],[5,5+(i%3)*1.5,6],'#747f91');
            box('路面中线',[0,.008,z],[.09,.01,3],'#bcc4d1');
            add('prop','streetlight','街边灯柱',[-3.8,0,z],'#828e9b');
            light('light-point',i%2?'暖色街灯':'蓝色街灯',[i%2?3:-3,3.6,z],[0,0,z],i%2?'#ffbf83':'#78b5ff',95).light!.shadows=false;
        }
        add('prop','car','路边车辆',[3.1,0,-4],'#a1a9b5');
        box('路边货箱',[-3,0,-13],[1.2,1.1,1.2],'#b29477');
        const c=camera('A · 广角手持追逐',[2,1.4,15],[-.7,1.2,9],24);
        c.camera!.targetId=runner.id; c.camera!.targetHeight=1.15;
        c.path={smooth:true,points:[{time:0,position:[2,1.4,15]},{time:3,position:[1.6,1.2,5]},{time:6.5,position:[-1.5,1.6,-7]},{time:10,position:[1.1,1.3,-19]}]};
        c.camera!.effects={distortionType:'barrel',channels:{distortion:.22,bloom:.12,frameX:{keys:[{time:0,value:-.18},{time:5,value:.18,easing:'smooth'},{time:10,value:-.12,easing:'smooth'}]}},shake:{preset:'run',amount:.75,frequency:1,seed:19,start:0,end:10}};
    }
    return p;
}
