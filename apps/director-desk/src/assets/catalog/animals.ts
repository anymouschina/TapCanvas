import type { AssetDefinition } from './types.ts';
import { quadrupedParameterSchema } from './animal-options.ts';

export interface QuadrupedShape {
    body: number; leg: number; neck: number; head: number; muzzle: number; ear: number; tail: number;
    width: number; hoof?: boolean; horn?: boolean; species: 'dog' | 'cat' | 'rabbit' | 'rodent' | 'horse' | 'cow' | 'sheep' | 'pig' | 'deer' | 'turtle' | 'lizard' | 'camel' | 'bear' | 'lion' | 'tiger' | 'elephant' | 'giraffe' | 'gorilla';
}
const base: QuadrupedShape = { body: .7, leg: .42, neck: .14, head: .16, muzzle: .10, ear: .13, tail: .4, width: .17, species: 'dog' };
const presets: Array<{ id: string; name: string; height: number; group: string; shape: Partial<QuadrupedShape>; aliases: string[] }> = [
    { id: 'animal-dog-small', name: '小型犬', height: .38, group: '宠物', shape: { body: .65, leg: .32, ear: .17 }, aliases: ['狗', '宠物犬', 'dog'] },
    { id: 'animal-dog-large', name: '大型犬', height: .9, group: '宠物', shape: {}, aliases: ['狗', '大型狗', 'dog'] },
    { id: 'animal-cat', name: '猫', height: .4, group: '宠物', shape: { species: 'cat', body: .62, leg: .32, muzzle: .035, ear: .10, tail: .58, width: .13 }, aliases: ['小猫', 'cat'] },
    { id: 'animal-rabbit', name: '兔', height: .4, group: '宠物', shape: { species: 'rabbit', body: .46, leg: .14, head: .15, muzzle: .035, ear: .29, tail: .06, width: .18 }, aliases: ['兔子', 'rabbit'] },
    { id: 'animal-hamster', name: '仓鼠', height: .12, group: '宠物', shape: { species: 'rodent', body: .42, leg: .10, head: .14, muzzle: .04, ear: .07, tail: .025, width: .20 }, aliases: ['鼠', 'hamster'] },
    { id: 'animal-guineapig', name: '豚鼠', height: .22, group: '宠物', shape: { species: 'rodent', body: .58, leg: .10, head: .17, muzzle: .04, ear: .045, tail: .015, width: .22 }, aliases: ['荷兰猪', 'guinea pig'] },
    { id: 'animal-horse', name: '马', height: 2.15, group: '家畜坐骑', shape: { species: 'horse', body: .95, leg: .70, neck: .40, head: .20, muzzle: .22, ear: .12, tail: .60, width: .23, hoof: true }, aliases: ['坐骑', 'horse'] },
    { id: 'animal-donkey', name: '驴', height: 1.6, group: '家畜坐骑', shape: { species: 'horse', body: .85, leg: .60, neck: .28, muzzle: .20, ear: .24, tail: .42, width: .22, hoof: true }, aliases: ['坐骑', 'donkey'] },
    { id: 'animal-cow', name: '牛', height: 1.65, group: '家畜坐骑', shape: { species: 'cow', body: 1.0, leg: .58, neck: .16, head: .24, muzzle: .14, ear: .14, tail: .55, width: .31, hoof: true, horn: true }, aliases: ['家畜', 'cow'] },
    { id: 'animal-sheep', name: '羊', height: 1.0, group: '家畜坐骑', shape: { species: 'sheep', body: .80, leg: .40, neck: .17, head: .16, muzzle: .10, ear: .11, tail: .12, width: .29, hoof: true }, aliases: ['绵羊', 'sheep'] },
    { id: 'animal-goat', name: '山羊', height: 1.0, group: '家畜坐骑', shape: { species: 'sheep', body: .70, leg: .43, neck: .19, head: .15, muzzle: .12, ear: .13, tail: .11, width: .20, hoof: true, horn: true }, aliases: ['goat'] },
    { id: 'animal-pig', name: '猪', height: .85, group: '家畜坐骑', shape: { species: 'pig', body: .86, leg: .25, neck: .04, head: .23, muzzle: .15, ear: .14, tail: .14, width: .31, hoof: true }, aliases: ['pig'] },
    { id: 'animal-deer', name: '鹿', height: 1.8, group: '家畜坐骑', shape: { species: 'deer', body: .78, leg: .64, neck: .34, head: .15, muzzle: .13, ear: .17, tail: .11, width: .18, hoof: true, horn: true }, aliases: ['deer'] },
    { id: 'animal-wolf', name: '狼', height: 1.0, group: '野生动物', shape: { body: .85, leg: .5, head: .18, ear: .12, tail: .5, width: .19 }, aliases: ['wolf'] },
    { id: 'animal-fox', name: '狐狸', height: .55, group: '野生动物', shape: { body: .72, leg: .34, head: .13, muzzle: .14, ear: .18, tail: .66, width: .14 }, aliases: ['fox'] },
    { id: 'animal-turtle', name: '乌龟', height: .18, group: '宠物', shape: {species:'turtle',body:.7,leg:.12,neck:.04,head:.12,muzzle:.01,ear:0,tail:.10,width:.29}, aliases:['龟','turtle'] },
    { id: 'animal-lizard', name: '蜥蜴', height: .14, group: '宠物', shape: {species:'lizard',body:.8,leg:.10,neck:.02,head:.12,muzzle:.10,ear:0,tail:.85,width:.13}, aliases:['爬虫','lizard'] },
    { id: 'animal-camel', name: '骆驼', height: 2.5, group: '家畜坐骑', shape: {species:'camel',body:.95,leg:.75,neck:.42,head:.18,muzzle:.18,ear:.10,tail:.45,width:.25,hoof:true}, aliases:['坐骑','camel'] },
    { id: 'animal-bear', name: '熊', height: 1.5, group: '野生动物', shape: {species:'bear',body:1,leg:.47,neck:.05,head:.28,muzzle:.12,ear:.09,tail:.045,width:.38}, aliases:['bear'] },
    { id: 'animal-lion', name: '狮子', height: 1.4, group: '野生动物', shape: {species:'lion',body:1,leg:.56,neck:.12,head:.23,muzzle:.10,ear:.10,tail:.7,width:.25}, aliases:['狮','lion'] },
    { id: 'animal-tiger', name: '老虎', height: 1.2, group: '野生动物', shape: {species:'tiger',body:1.1,leg:.52,neck:.09,head:.23,muzzle:.09,ear:.09,tail:.72,width:.26}, aliases:['虎','tiger'] },
    { id: 'animal-elephant', name: '大象', height: 3.4, group: '野生动物', shape: {species:'elephant',body:1.3,leg:.82,neck:.1,head:.38,muzzle:.08,ear:.08,tail:.45,width:.48}, aliases:['象','elephant'] },
    { id: 'animal-giraffe', name: '长颈鹿', height: 5.0, group: '野生动物', shape: {species:'giraffe',body:.9,leg:.98,neck:1.25,head:.19,muzzle:.17,ear:.13,tail:.47,width:.25,hoof:true}, aliases:['giraffe'] },
    { id: 'animal-gorilla', name: '猩猩', height: 1.65, group: '野生动物', shape: {species:'gorilla',body:.6,leg:.55,neck:.07,head:.24,muzzle:.08,ear:.045,tail:0,width:.37}, aliases:['大猩猩','gorilla','ape'] },
];
export const QUADRUPED_SHAPES: Readonly<Record<string, QuadrupedShape>> = Object.fromEntries(presets.map(p => [p.id, { ...base, ...p.shape }]));
export const QUADRUPED_JOINTS = { head: '头部俯仰', headYaw: '头部转向', torso: '躯干俯仰', leftArm: '左前腿', rightArm: '右前腿', leftElbow: '左前腿下段', rightElbow: '右前腿下段', leftHip: '左后腿', rightHip: '右后腿', leftKnee: '左后腿下段', rightKnee: '右后腿下段' };
export const ANIMAL_ASSETS: readonly AssetDefinition[] = presets.map(p => ({ id: p.id, name: p.name, kind: 'actor', group: p.group, icon: '♧', family: 'quadruped-v1', aliases: p.aliases,
    parameters: quadrupedParameterSchema(QUADRUPED_SHAPES[p.id]),
    defaults: { height: p.height }, joints: QUADRUPED_JOINTS, capabilities: { rig: 'quadruped', actions: ['idle'], pose: true, path: true } }));
