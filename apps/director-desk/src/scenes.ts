import {createAbstractShowcase} from './scenes/abstract-showcase.ts';
import { finishStarterScene, type StarterScene } from './scenes/starter-details.ts';
import { demoProject, entity, type Project, type Vec3 } from './model.ts';
import { createFeatureScene, FEATURE_SCENES, type FeatureScene } from './scenes/feature-showcases.ts';

export const SCENE_TEMPLATES = [
    ...FEATURE_SCENES,
    {id:'abstract-stage',name:'流光空间',type:'抽象 · 10 秒',detail:'粒子与漩涡、薄膜、镜面、折射和关键帧形变'},
    { id: 'bedroom', name: '卧室 · 四人调度', type: '室内', detail: '窗光与床头暖灯、家具配色、四人调度' },
    { id: 'room', name: '空房间', type: '室内', detail: '8 × 6 米，窗光、墙裙和木地板，留空布置' },
    { id: 'park', name: '林地空地', type: '室外', detail: '前后景树群、林间步道、长椅与双人调度' },
    { id: 'street', name: '街道', type: '室外', detail: '黄昏商铺、雨棚与花盆、人行道和路灯' },
    { id: 'courtyard', name: '庭院', type: '室外', detail: '入口门架、格栅凉棚、花坛与台阶平台' },
    { id: 'blank', name: '空白场地', type: '自由搭建', detail: '仅地面和摄影机，所有内容由你摆放' },
] as const;
export type SceneTemplate = typeof SCENE_TEMPLATES[number]['id'];

export function createScene(template: SceneTemplate): Project {
    if(template==='abstract-stage')return createAbstractShowcase();
    if (FEATURE_SCENES.some(t => t.id === template)) return createFeatureScene(template as FeatureScene);
    if (template === 'bedroom') return finishStarterScene(demoProject(), 'bedroom');
    const p = demoProject();
    p.name = SCENE_TEMPLATES.find(t => t.id === template)?.name ?? '空白场地';
    p.entities = []; p.references = [];
    p.room = { enabled: template === 'room', width: 8, depth: 6, height: 2.8 };
    const prop = (asset: string, name: string, position: Vec3, scale: Vec3 = [1, 1, 1], color = '#d5d5d0') => {
        const e = entity('prop', asset, name, position); e.scale = scale; e.color = color; p.entities.push(e); return e;
    };
    if (template !== 'room') prop('ground', '地面 · 可缩放', [0, 0, 0], [4, 1, 4], '#b4b6ae');
    if (template === 'park') {
        for (const [i, pos] of [[-7, 0, -5], [-3, 0, -7], [4, 0, -6], [8, 0, -2], [-7, 0, 4], [5, 0, 5]].entries())
            prop('tree', `树木 ${i + 1}`, pos as Vec3, [1.3, 1.3 + i * .08, 1.3]);
        prop('bench', '林间长椅', [0, 0, -3]);
        prop('rock', '岩石 A', [-4, 0, 0], [1.7, 1.4, 1.5]);
        prop('rock', '岩石 B', [5, 0, 2]);
    }
    if (template === 'street') {
        prop('road', '道路 · 可缩放', [0, .008, 0], [1, 1, 3], '#9a9b99');
        for (let i = 0; i < 3; i++) {
            prop('building', `西侧楼体 ${i + 1}`, [-7, 0, -8 + i * 8], [1, 1 + i * .25, 1.2]);
            prop('building', `东侧楼体 ${i + 1}`, [7, 0, -8 + i * 8], [1, 1.4 - i * .2, 1.2]);
            prop('streetlight', `路灯 ${i + 1}`, [-3.5, 0, -8 + i * 8]);
        }
        prop('car', '路边车辆', [2, .008, -3]);
    }
    if (template === 'courtyard') {
        prop('wall', '北围墙', [0, 0, -6], [6, .75, 1.5]);
        for (const x of [-6, 6]) prop('wall', x < 0 ? '西围墙' : '东围墙', [x, 0, 0], [6, .75, 1.5]).rotation[1] = Math.PI / 2;
        prop('fence', '入口左围栏', [-4, 0, 6], [2, 1, 1]);
        prop('fence', '入口右围栏', [4, 0, 6], [2, 1, 1]);
        prop('table', '庭院桌', [0, 0, -1]);
        prop('chair', '庭院椅', [0, 0, .2]);
        prop('tree', '庭院树', [-4, 0, -3], [1.3, 1.3, 1.3]);
        prop('stairs', '台阶', [4, 0, -4]);
    }
    const camera = entity('camera', 'camera', 'A · 主机位', template === 'room' ? [3, 1.65, 2] : [8, 3, 10]);
    camera.camera!.target = [0, 1, 0]; camera.camera!.focal = 28;
    if (template === 'street') { camera.position = [0, 1.7, 12]; camera.camera!.target = [0, 1.3, -4]; }
    if (template === 'courtyard') camera.position = [0, 1.7, 5];
    p.entities.push(camera); p.cuts = [{ time: 0, cameraId: camera.id }];
    return template === 'blank' ? p : finishStarterScene(p, template as StarterScene);
}
