/** Portable anatomical mapping; no renderer or loader dependency. Rotations are local XYZ offsets in radians. */
export const HUMAN_BONES = {
    hips: '骨盆', spine: '脊柱', chest: '胸部', upperChest: '上胸', neck: '颈部', head: '头部',
    leftShoulder: '左肩', leftUpperArm: '左上臂', leftLowerArm: '左前臂', leftHand: '左手',
    rightShoulder: '右肩', rightUpperArm: '右上臂', rightLowerArm: '右前臂', rightHand: '右手',
    leftUpperLeg: '左大腿', leftLowerLeg: '左小腿', leftFoot: '左脚', leftToes: '左脚趾',
    rightUpperLeg: '右大腿', rightLowerLeg: '右小腿', rightFoot: '右脚', rightToes: '右脚趾'
} as const;
export type HumanBone = keyof typeof HUMAN_BONES;
export interface BoneDescriptor { path: string; name: string; parent: string | null }
export interface HumanoidRig { version: 1; family: 'humanoid'; bones: Partial<Record<HumanBone, string>> }
export type ModelRestPose = Record<string, [number, number, number]>;
const optional = new Set<HumanBone>(['chest', 'upperChest', 'neck', 'leftShoulder', 'rightShoulder', 'leftToes', 'rightToes']);
export const REQUIRED_HUMAN_BONES = (Object.keys(HUMAN_BONES) as HumanBone[]).filter(key => !optional.has(key));
const parent: Record<HumanBone, HumanBone | null> = {
    hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
    leftShoulder: 'upperChest', leftUpperArm: 'leftShoulder', leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm',
    rightShoulder: 'upperChest', rightUpperArm: 'rightShoulder', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
    leftUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', leftFoot: 'leftLowerLeg', leftToes: 'leftFoot',
    rightUpperLeg: 'hips', rightLowerLeg: 'rightUpperLeg', rightFoot: 'rightLowerLeg', rightToes: 'rightFoot'
};
export const isBonePath = (path: unknown): path is string => typeof path === 'string' && path.length <= 1024 && /^0(?:\/(?:0|[1-9]\d*))*$/.test(path);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function assertRigDefinition(rig: HumanoidRig | undefined, pose: ModelRestPose | undefined) {
    if (rig !== undefined) {
        if (!record(rig) || Object.keys(rig).some(key => !['version', 'family', 'bones'].includes(key)) || rig.version !== 1 || rig.family !== 'humanoid' || !record(rig.bones)) throw Error('人形骨骼映射格式无效');
        const used = new Set<string>();
        for (const [key, path] of Object.entries(rig.bones)) {
            if (!Object.hasOwn(HUMAN_BONES, key) || !isBonePath(path) || used.has(path)) throw Error('骨骼映射部位、路径无效或重复');
            used.add(path);
        }
        for (const key of Object.keys(rig.bones) as HumanBone[]) {
            let ancestor = parent[key]; while (ancestor && !rig.bones[ancestor]) ancestor = parent[ancestor];
            if (ancestor && !rig.bones[key]!.startsWith(rig.bones[ancestor]! + '/')) throw Error(HUMAN_BONES[key] + '不在已映射的' + HUMAN_BONES[ancestor] + '下方');
        }
    }
    if (pose !== undefined) {
        if (!record(pose)) throw Error('默认姿态格式无效');
        for (const [path, angles] of Object.entries(pose)) if (!isBonePath(path) || !Array.isArray(angles) || angles.length !== 3 || angles.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > Math.PI * 2)) throw Error('默认姿态需使用有效骨骼路径与局部 XYZ 弧度旋转');
    }
}
export function assertRigBindings(rig: HumanoidRig | undefined, pose: ModelRestPose | undefined, bones: readonly BoneDescriptor[]) {
    assertRigDefinition(rig, pose);
    const available = new Set(bones.map(b => b.path));
    for (const path of [...Object.values(rig?.bones ?? {}), ...Object.keys(pose ?? {})]) if (!available.has(path)) throw Error('映射或默认姿态引用了源模型不存在的骨骼：' + path);
}
export function rigStatus(rig?: HumanoidRig) {
    const missing = REQUIRED_HUMAN_BONES.filter(key => !rig?.bones[key]);
    return { mapped: Object.keys(rig?.bones ?? {}).length, requiredMapped: REQUIRED_HUMAN_BONES.length - missing.length, missing, complete: !missing.length };
}
const normalize = (name: string) => name.replace(/^.*:/, '').replace(/^mixamorig\d*/i, '').replace(/^skeleton_/i, '').replace(/^DEF[-_]/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const aliases: Partial<Record<HumanBone, string[]>> = {
    hips: ['hips', 'pelvis', 'torsojoint1'], spine: ['spine', 'torsojoint2', 'spine01', 'spine001'], chest: ['chest', 'spine1', 'torsojoint3', 'spine02', 'spine002'], upperChest: ['upperchest', 'spine2', 'spine03', 'spine003'],
    neck: ['neck', 'neckjoint1', 'neck01'], head: ['head', 'neckjoint2']
};
for (const side of ['left', 'right'] as const) {
    aliases[`${side}Shoulder`] = [`${side}shoulder`, `${side}clavicle`];
    aliases[`${side}UpperArm`] = [`${side}arm`, `${side}upperarm`];
    aliases[`${side}LowerArm`] = [`${side}forearm`, `${side}lowerarm`];
    aliases[`${side}Hand`] = [`${side}hand`];
    aliases[`${side}UpperLeg`] = [`${side}upleg`, `${side}thigh`, `${side}upperleg`];
    aliases[`${side}LowerLeg`] = [`${side}leg`, `${side}calf`, `${side}lowerleg`];
    aliases[`${side}Foot`] = [`${side}foot`]; aliases[`${side}Toes`] = [`${side}toebase`, `${side}toes`];
    // Observed Blender DEF and Unreal suffix names; keep zero-padded spine numbering distinct from Mixamo Spine1/2.
    const suffix = side[0];
    aliases[`${side}Shoulder`]!.push(`shoulder${suffix}`, `clavicle${suffix}`);
    aliases[`${side}UpperArm`]!.push(`upperarm${suffix}`);
    aliases[`${side}LowerArm`]!.push(`forearm${suffix}`, `lowerarm${suffix}`);
    aliases[`${side}Hand`]!.push(`hand${suffix}`);
    aliases[`${side}UpperLeg`]!.push(`thigh${suffix}`, `upperleg${suffix}`);
    aliases[`${side}LowerLeg`]!.push(`shin${suffix}`, `calf${suffix}`, `lowerleg${suffix}`);
    aliases[`${side}Foot`]!.push(`foot${suffix}`);
    aliases[`${side}Toes`]!.push(`toe${suffix}`, `toes${suffix}`, `ball${suffix}`);

}
export function suggestHumanoidRig(bones: readonly BoneDescriptor[]) {
    const rig: HumanoidRig = { version: 1, family: 'humanoid', bones: {} }, candidates: Partial<Record<HumanBone, string[]>> = {};
    const names = new Map(bones.map(b => [b.path, normalize(b.name)]));
    const topDuplicates = (list: readonly BoneDescriptor[]) => list.filter(b => !list.some(a => a.path !== b.path && b.path.startsWith(a.path + '/') && names.get(a.path) === names.get(b.path)));
    for (const key of Object.keys(HUMAN_BONES) as HumanBone[]) {
        const found = topDuplicates(bones.filter(b => aliases[key]?.includes(names.get(b.path)!)));
        candidates[key] = found.map(b => b.path); if (found.length === 1) rig.bones[key] = found[0].path;
    }
    // Numbered joint names differ across exporters; use their actual chain order, not suffix numbers.
    for (const side of ['left', 'right'] as const) for (const limb of ['arm', 'leg'] as const) {
        const pattern = new RegExp(`^${limb}joint${side[0]}\\d*$`), found = topDuplicates(bones.filter(b => pattern.test(names.get(b.path)!))).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
        if (found.length < 3 || found.some((b, i) => i && !b.path.startsWith(found[i - 1].path + '/'))) continue;
        const keys: HumanBone[] = limb === 'arm' ? [`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`] : [`${side}UpperLeg`, `${side}LowerLeg`, `${side}Foot`, `${side}Toes`];
        keys.forEach((key, i) => { if (!rig.bones[key] && found[i]) { rig.bones[key] = found[i].path; candidates[key] = [found[i].path]; } });
    }
    // Keep a suggestion anatomically coherent. Ambiguous/mis-parented choices remain available for manual review.
    for (const key of Object.keys(rig.bones) as HumanBone[]) {
        let ancestor = parent[key]; while (ancestor && !rig.bones[ancestor]) ancestor = parent[ancestor];
        if (ancestor && !rig.bones[key]!.startsWith(rig.bones[ancestor]! + '/')) delete rig.bones[key];
    }
    assertRigDefinition(rig, undefined);
    return { rig, candidates, ...rigStatus(rig) };
}
