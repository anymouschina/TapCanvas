/** Pure data shared by the editor, validation, automation and offline generator. */
export const HUMAN_JOINTS = { head: '头部俯仰', headYaw: '头部转向', torso: '躯干', leftArm: '左肩', rightArm: '右肩', leftElbow: '左肘', rightElbow: '右肘', leftHip: '左髋', rightHip: '右髋', leftKnee: '左膝', rightKnee: '右膝' };
export const BIRD_JOINTS = { head: '头部俯仰', headYaw: '头部转向', torso: '躯干俯仰', leftWing: '左翼抬起', rightWing: '右翼抬起', leftHip: '左腿', rightHip: '右腿', leftKnee: '左腿下段', rightKnee: '右腿下段', tail: '尾部转向' };
export const FISH_JOINTS = { head: '头部俯仰', headYaw: '头部转向', torso: '躯干俯仰', leftFin: '左胸鳍', rightFin: '右胸鳍', tail: '尾柄转向', tailTip: '尾鳍转向' };
export const SERPENT_JOINTS = { head: '头部俯仰', headYaw: '头部转向', torso: '前身转向', tail: '中段转向', tailTip: '尾段转向' };
export const JOINT_LABELS = { ...HUMAN_JOINTS, leftWing: '左翼', rightWing: '右翼', leftFin: '左胸鳍', rightFin: '右胸鳍', tail: '尾部', tailTip: '尾端' };
export type JointName = keyof typeof JOINT_LABELS;
export type JointLabels = Partial<Record<JointName, string>>;
export function mirrorPose(pose: Partial<Record<JointName, number>>, yawTorso = false) {
    const mirrored: typeof pose = {};
    for (const [key, value] of Object.entries(pose)) {
        const other = key.startsWith('left') ? key.replace('left', 'right') : key.startsWith('right') ? key.replace('right', 'left') : key;
        mirrored[other as JointName] = ['headYaw', 'tail', 'tailTip'].includes(key) || (yawTorso && key === 'torso') ? -value : value;
    }
    return mirrored;
}
