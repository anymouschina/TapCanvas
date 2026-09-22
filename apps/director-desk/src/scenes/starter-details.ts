import { clip, type Project, type Vec3 } from '../model.ts';
import { lightingPreset } from '../lighting/presets.ts';
import { defaultLighting } from '../lighting/model.ts';
import { applyCameraMotion } from '../cinematography/motion-presets.ts';
import { templateBuilder } from './template-builder.ts';

export type StarterScene = 'bedroom' | 'room' | 'park' | 'street' | 'courtyard';

/** Finish the original starter sets without changing the minimal blank template or user projects. */
export function finishStarterScene(p: Project, template: StarterScene): Project {
    const {add,box,actor,light}=templateBuilder(p);
    const camera=p.entities.find(e=>e.camera)!;
    const ground=p.entities.find(e=>e.asset==='ground');
    const path=(points: Vec3[])=>({smooth:true,points:points.map((position,i)=>({time:p.duration*i/(points.length-1),position}))});
    if(template==='bedroom'||template==='room') {
        const {width:w,depth:d}=p.room;
        p.lighting={...defaultLighting(),defaultLights:false,ambient:.75,background:'#a7b1bd',groundColor:'#887b6d'};
        box('浅木色地板',[0,.002,0],[w,.012,d],'#a48c72');
        // Frame the existing real window opening; keep its light path and the door clear.
        for(const z of [-.91,.91]) box('窗帘侧幅',[-w/2+.13,.76,z],[.16,1.78,.25],'#7a8d9d');
        box('窗帘横杆',[-w/2+.13,2.55,0],[.1,.05,2.3],'#4f5b66');
        box('加宽窗台',[-w/2+.1,.91,0],[.28,.07,1.65],'#cbbfa8');
        // Area light outside the opening lights the interior without adding a fake visible wall.
        const windowLight=light('light-area','窗外日光',[-w/2-.25,1.75,0],[0,1,0],'#c9dfff',4.5);
        windowLight.light!.width=1.4;windowLight.light!.height=1.2;
        const fill=light('light-area','室内柔光',[w/2-.3,2.45,d/2-.35],[0,1,0],'#ffe1bc',2);
        fill.light!.width=2;fill.light!.height=1.2;
        const ceiling=light('light-spot','顶部柔光',[.4,2.55,.6],[0,0,0],'#ffe2bc',30);
        ceiling.light!.angle=65;ceiling.light!.penumbra=.85;
        if(template==='bedroom') {
            const palette:Record<string,string>={bed:'#7a929f',nightstand:'#927961',wardrobe:'#c4b6a0',desk:'#9b8064',chair:'#81909b',lamp:'#d4c3a0',laptop:'#596572'};
            for(const e of p.entities)if(palette[e.asset])e.color=palette[e.asset];
            box('床边地毯',[.45,.016,.55],[1.25,.012,1.55],'#b7afa0');
            box('床头装饰画边框',[-1.15,1.38,-d/2+.07],[1.1,.65,.05],'#75634f');
            box('床头装饰画',[-1.15,1.44,-d/2+.11],[.96,.52,.025],'#a4b8b4');
            const lamp=light('light-point','床头暖灯',[-2.03,1.0,-1.6],[-1,1,0],'#ffca8c',6);lamp.light!.shadows=false;
            const seated=p.entities.find(e=>e.kind==='actor')!;
            seated.position=[-.3,0,-.75];
            seated.path={smooth:false,points:[{time:0,position:[-.3,0,-.75]},{time:7,position:[-.3,0,-.75]},{time:9,position:[.3,0,-.75]}]};
            camera.name='A · 窗光室内全景';camera.position=[3.7,2.3,3.2];camera.camera!.target=[-.25,.95,0];camera.camera!.focal=24;
            camera.path=path([[3.7,2.3,3.2],[3.5,2.2,3.1]]);
            camera.camera!.hideWalls=['south','east','ceiling'];camera.camera!.effects={channels:{bloom:.06}};
        }else {
            box('北侧墙裙',[0,.12,-d/2+.025],[w,.8,.035],'#8999a3');
            box('墙裙压条',[0,.92,-d/2+.06],[w,.035,.065],'#e4d9c5');
            for(const x of [-2.6,-1.3,0,1.3,2.6])box('墙面分格',[x,.12,-d/2+.053],[.025,.8,.02],'#bdc6c7');
            camera.name='A · 空间巡览';camera.position=[3,1.8,2.25];camera.camera!.target=[-1,1,-1.1];camera.camera!.focal=22;
            applyCameraMotion(p,camera.id,'truck',0,p.duration,{amplitude:1.4,side:-1,easing:'smooth'});
        }
    }else if(template==='park') {
        p.lighting={...lightingPreset('daylight'),ambient:1.2,sunColor:'#ffe0ac',sunIntensity:2.5,sunDirection:[-5,3,2],background:'#9eafae',groundColor:'#71805b'};
        ground!.color='#7b8b69';
        for(const e of p.entities){if(e.asset==='tree')e.color='#637958';if(e.asset==='rock')e.color='#949b8d';if(e.asset==='bench')e.color='#967b60';}
        const trees:Vec3[]=[[-11,0,-9],[-8,0,-11],[-4,0,-12],[1,0,-11],[6,0,-10],[11,0,-7],[-11,0,1],[11,0,4]];
        trees.forEach((pos,i)=>add('prop','tree',`远景树 ${i+1}`,pos,['#60745a','#84926a','#526b58'][i%3],[1.6,1.5+(i%3)*.3,1.6]));
        box('林间步道',[1.8,.014,0],[2.2,.025,17],'#c3b59b');
        box('长椅前铺地',[.1,.014,-2.5],[4,.025,2],'#b6aa91');
        for(let i=0;i<7;i++) {
            const z=-7+i*2.2;
            if(Math.abs(z+3)>1.3)add('prop','rock',`路沿矮石 ${i+1}`,[-.15,.02,z],'#a5ab97',[.4,.45,.55]);
            add('prop','sphere',`林下灌木 ${i+1}`,[-6+(i%2)*1.1,0,-5+i*1.6],i%2?'#6f865d':'#4f6d54',[1.4,.65,1.2]);
        }
        const seated=actor('人物 A · 长椅',[0,.04,-3],'#caad84');seated.clips=[clip('sit',0,p.duration)];
        const walker=actor('人物 B · 林间步道',[1.8,.04,5],'#839eb4');walker.path=path([[1.8,.04,5],[1.8,.04,0],[1.8,.04,-5]]);walker.clips=[clip('walk',0,p.duration)];
        camera.name='A · 林间侧移';camera.position=[.2,2.6,8];camera.camera!.target=[.2,1,-2];camera.camera!.focal=30;
        applyCameraMotion(p,camera.id,'truck',0,p.duration,{amplitude:3,side:-1,easing:'smooth'});
    }else if(template==='street') {
        p.lighting={...lightingPreset('dusk'),ambient:.9,sunIntensity:2.1,background:'#a1a5b3'};ground!.color='#82878a';
        const tones=['#b7ab96','#8798a1','#b3947e'];
        p.entities.filter(e=>e.asset==='building').forEach((e,i)=>{e.color=tones[i%3];});
        p.entities.find(e=>e.asset==='road')!.color='#5a616b';
        p.entities.find(e=>e.asset==='car')!.color='#7e9baf';
        for(const x of [-4,4]) {
            box('人行道',[x,.01,0],[2,.13,30],'#b6b0a3');
            box('路沿',[Math.sign(x)*3.03,.01,0],[.12,.19,30],'#d0c8b6');
            for(let i=0;i<3;i++) {
                const z=-8+i*8,side=Math.sign(x);
                box('商铺入口',[side*4.97,.14,z],[.055,2.3,1.8],'#53616c');
                for(const y of [3.3,4.8])for(const offset of [-1,1])box('沿街窗格',[side*4.97,y,z+offset],[.06,.9,1.05],'#5c7180');
                box('店面雨棚',[side*4.45,2.5,z],[1.15,.14,3.3],i%2?'#657c7a':'#aa8062');
                box('雨棚支架',[side*4,2.15,z-1.5],[.06,.35,.06],'#5b646a');
                add('prop','cylinder','街边花盆',[side*4,.14,z+2.6],'#b0a08b',[.6,.48,.6]);
                add('prop','sphere','盆栽树冠',[side*4,.5,z+2.6],'#748264',[.8,1,.8]);
            }
        }
        for(let i=0;i<6;i++)box('斑马线',[ -2.5+i,.018,5.2],[.55,.008,2.2],'#d3cec2');
        p.entities.filter(e=>e.asset==='streetlight').forEach((e,i)=>{e.color='#58626b';const lamp=light('light-point',`路灯光源 ${i+1}`,[e.position[0]+.7,3.85,e.position[2]],[0,0,0],'#ffd0a0',18);lamp.light!.shadows=false;});
        const passer=actor('人物 A · 人行道',[-4,.14,8],'#a3b3bd');passer.path=path([[-4,.14,8],[-4,.14,2],[-4,.14,-4]]);passer.clips=[clip('walk',0,p.duration)];
        actor('人物 B · 店前',[4,.14,-1],'#c0a184').rotation[1]=-Math.PI/2;
        camera.name='A · 街道推进';camera.position=[.5,1.85,13];camera.camera!.target=[0,1.3,-5];camera.camera!.focal=28;
        applyCameraMotion(p,camera.id,'push',0,p.duration,{amplitude:6,easing:'smooth'});
    }else {
        p.lighting={...lightingPreset('daylight'),ambient:1.1,sunColor:'#ffdfb2',sunIntensity:2.3,sunDirection:[-4,4,-1],background:'#a6b5bc'};ground!.color='#859278';
        for(const e of p.entities){if(e.asset==='wall')e.color='#c4baa8';if(e.asset==='fence')e.color='#88715b';if(e.asset==='tree')e.color='#677e60';if(['table','chair'].includes(e.asset))e.color='#9b8065';}
        box('庭院铺地',[0,.002,0],[11.7,.025,11.7],'#b3ada0');
        for(const x of [-4.5,4.5])box('花坛土壤',[x,.028,1],[1.8,.12,5],'#7b7e60');
        for(let i=0;i<5;i++)for(const x of [-4.5,4.5])add('prop','sphere','花坛灌木',[x,.15,-.7+i*.9],'#607b58',[.9,.6,.85]);
        for(const x of [-1.6,1.6])box('入口立柱',[x,0,5.85],[.3,2.8,.3],'#8b7962');
        box('入口横梁',[0,2.7,5.85],[3.8,.25,.5],'#8b7962');
        for(const x of [-1.5,1.5])for(const z of [-3,-5])box('凉棚立柱',[x,.028,z],[.16,2.8,.16],'#88725d');
        for(let i=0;i<7;i++)box('凉棚顶格栅',[-1.8+i*.6,2.8,-4],[.14,.12,2.6],'#9d886c');
        for(const z of [-3,-5])box('凉棚横梁',[0,2.7,z],[3.8,.15,.2],'#88725d');
        add('prop','bench','凉棚长椅',[0,.028,-4.6],'#988169');
        // Existing stairs now end at a real landing, instead of stopping in mid-air.
        box('台阶平台',[4,0,-5.35],[1.5,1.08,1.25],'#b0aaa0');
        box('平台护栏',[4,1.08,-5.9],[1.5,.85,.08],'#8d7e68');
        const chair=p.entities.find(e=>e.asset==='chair')!;chair.position[1]=.028;chair.rotation[1]=Math.PI;
        p.entities.find(e=>e.asset==='table')!.position[1]=.028;
        const seated=actor('人物 A · 庭院桌旁',[0,.028,.2],'#b79c80');seated.rotation[1]=Math.PI;seated.clips=[clip('sit',0,p.duration)];
        const walker=actor('人物 B · 庭院步道',[2,.028,4.5],'#7d9bab');walker.path=path([[2,.028,4.5],[2,.028,1],[2,.028,-2.5]]);walker.clips=[clip('walk',0,p.duration)];
        camera.name='A · 入院缓推';camera.position=[.4,2,5.1];camera.camera!.target=[0,1,-2.3];camera.camera!.focal=22;
        applyCameraMotion(p,camera.id,'truck',0,p.duration,{amplitude:1.1,side:-1,easing:'smooth'});
    }
    return p;
}
