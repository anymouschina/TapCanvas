import { ACTIONS } from '../model.ts';
import { spatialRelationship, type SpatialObject, type SpatialReport } from './report.ts';
import type { SampleVisibility } from './visibility.ts';

export const frameLabels = { inside: '包围盒完整入画', intersecting: '包围盒被画幅或远近裁切面裁切', outside: '包围盒在画外', hidden: '已隐藏', 'not-rendered': '摄影机辅助模型不参与成片', unknown: '无法确定' };
const num = (v: number) => (Math.abs(v) < .0005 ? 0 : v).toFixed(3);
const vector = (v: number[]) => v.map(num).join(', ');
export function describeVisibility(label: string, value: SampleVisibility): string {
    const labels = { 'unblocked-samples': '命中采样点均未被遮挡', 'partly-blocked-samples': '部分采样点被遮挡', 'blocked-samples': '命中采样点均被遮挡',
        'no-samples': '射线未命中目标，无法判断', 'out-of-frame': '在画外', hidden: '已隐藏', 'not-facing-camera': '脸部未朝向机位', 'not-applicable': '不适用（无头部或 POV 隐藏头部）' };
    return `${label}：${labels[value.status]}；未遮挡 ${value.unblocked} / 命中 ${value.targetSamples} 个采样点${value.blockers.length ? '；遮挡者：' + value.blockers.map(b => `${b.name}（${b.samples}）`).join('、') : ''}`;
}
export function describeSpatialObject(o: SpatialObject): string {
    const animation = o.retargetAnimation ?? o.nativeAnimation;
    const action = o.action === 'native' || o.action === 'retarget' ? `${o.action === 'retarget' ? '适配动作' : '原生动画'} ${animation?.name ?? ''} · 素材 ${animation?.sourceTime.toFixed(2) ?? '?'} 秒（${animation?.motion === 'inPlace' ? '路径控制水平走位' : '含源位移'}）` : o.action === 'held' ? '保持接拍继承姿态' : o.action ? ACTIONS[o.action] : '不适用';
    const lines = [`${o.name} [${o.key}]`, `根节点位置 XYZ：(${vector(o.origin)}) m`,
        `世界朝向：(${vector(o.forward)})；水平角：${o.headingDegrees === null ? '未知' : num(o.headingDegrees) + '°'}`,
        `动作：${action}；取景：${frameLabels[o.framing.status]}`];
    const locomotion = o.retargetAnimation?.locomotion;
    if (o.motionTransition) lines.push(`素材衔接：${o.motionTransition.fromClipId ?? '默认姿态'} → ${o.motionTransition.toClipId ?? '默认姿态'}；当前动作权重 ${num(o.motionTransition.weight)}。画面使用混合后的姿态，素材时间表示当前基础动作的采样时间。`);
    if (locomotion) lines.push(`迈步：按路程；每周期 ${num(locomotion.cycleDistance)} m；当前素材速度约 ${num(locomotion.playbackRate)} 倍${locomotion.warning ? '；步频偏' + (locomotion.warning === 'too-fast' ? '快' : '慢') + '，请调整走位时长、周期距离或选择更合适的动作' : ''}。停留时定格；尚未自动修正脚底接触和停步过渡。`);
    if (o.bounds) lines.push(`世界轴对齐边界：最小 (${vector(o.bounds.min)})，最大 (${vector(o.bounds.max)}) m`,
        `边界尺寸 XYZ：(${vector(o.bounds.size)}) m；边界中心：(${vector(o.bounds.center)}) m`);
    else lines.push('物理边界：不适用');
    if (o.footGrounding?.pelvis) {
        const pelvis = o.footGrounding.pelvis;
        lines.push(`身体上抬：${num(pelvis.lift)} m（额度 ${num(pelvis.limit)} m）；骨盆世界位置 (${vector(pelvis.positionWorld)}) m。根站位／路径未改写；剩余修正由双腿处理。`);
    }
    if (o.footGrounding) for (const foot of o.footGrounding.feet) lines.push(`足部防穿透 · ${foot.side === 'left' ? '左' : '右'}脚：${({ clear: '无需上抬', corrected: '已修正', limited: '修正受限', 'no-surface': '范围内无承托面' })[foot.status]}；请求上抬 ${num(foot.requested)} m，剩余 ${num(foot.residual)} m。采用足部代表顶点，不是全网格碰撞。`);
    if (o.footPlant) for (const foot of o.footPlant) lines.push(`支撑脚锁定 · ${foot.side === 'left' ? '左' : '右'}脚：${({ locked: '已锁定', blending: '接触过渡', limited: '修正受限', 'no-surface': '锚点附近无承托面' })[foot.status]}；落脚时刻 ${num(foot.anchorTime)} s，权重 ${num(foot.weight)}，水平偏离锚点 ${num(foot.residual)} m。`);
    if (o.handBinding) lines.push(`手持绑定：人物 ${o.handBinding.actorId} · ${o.handBinding.hand === 'left' ? '左手' : '右手'}；握持偏移 (${vector(o.handBinding.offset)}) m；上方站位和边界为实际绑定后状态。`);
    if (o.contactAnchors?.length) lines.push('承托参考点（世界坐标）：' + o.contactAnchors.map(a => `${a.id} / ${({seat:'座位',surface:'承托面',bed:'床面'} as Record<string,string>)[a.role] ?? a.role} (${vector(a.position)}) m`).join('；'));
    const r = o.framing.rectangle;
    if (r) lines.push(`画幅内投影范围：左 ${num(r.left)}，上 ${num(r.top)}，右 ${num(r.right)}，下 ${num(r.bottom)}（0—1）`);
    if (o.visibility) lines.push(describeVisibility('身体遮挡', o.visibility.body), describeVisibility('脸部区域', o.visibility.face));
    else lines.push('遮挡：未检查');
    return lines.join('\n');
}
export function formatSpatialReport(report: SpatialReport, aKey?: string, bKey?: string, full = false): string {
    const lines = [`${report.projectName} · 空间报告`, `时间：${num(report.time)} / ${num(report.duration)} 秒；${report.fps} fps；${report.aspect}`,
        `摄影机：${report.camera.name}；位置 (${vector(report.camera.position)}) m；焦距 ${report.camera.focal} mm`,
        `${report.counts.entities} 个项目对象；${report.counts.people} 人，其中 ${report.counts.enabledPeople} 人启用显示；${report.counts.animals ?? 0} 只动物`,
        '单位：米、秒、度。位置为世界 XYZ，+Y 向上；画面坐标原点在左上角。', ''];
    const a = report.objects.find(o => o.key === aKey), b = report.objects.find(o => o.key === bKey);
    if (a && b && a.key !== b.key) {
        const r = spatialRelationship(report, a.key, b.key);
        lines.push(`比较：${a.name} → ${b.name}`, `根节点直线距离：${num(r.originDistance)} m；地面投影距离：${num(r.groundDistance)} m`,
            `B 相对 A 的 XYZ 位移：(${vector(r.deltaWorld)}) m；根节点高差：${num(r.heightDifference)} m`,
            `B 与 A 朝向的水平夹角：${r.angleFromAForward === null ? '未知（方向或水平距离不足）' : num(r.angleFromAForward) + '°（0° 在前，180° 在后）'}`);
        if (r.bounds) lines.push(`包围盒最短间隔：${num(r.bounds.aabbGap)} m；关系：${r.bounds.aabbOverlap ? '重叠，需人工确认是否实际穿插' : r.bounds.aabbTouching ? '边界接触' : '分离'}`);
        lines.push('两者之间是否有障碍：未检查', '');
    }
    const selected = [a, b].filter((o, index, arr): o is SpatialObject => !!o && arr.findIndex(other => other?.key === o.key) === index);
    for (const o of selected) {
        if (o.framing.status === 'outside') lines.push(`待确认：${o.name} 的包围盒在该机位画外。`);
        if (o.framing.status === 'intersecting') lines.push(`待确认：${o.name} 的包围盒存在裁切。`);
        lines.push(describeSpatialObject(o), '');
    }
    if (full) {
        lines.push('其他对象');
        for (const o of report.objects.filter(o => !selected.some(s => s.key === o.key))) lines.push(describeSpatialObject(o), '');
    }
    lines.push('计算范围', ...report.limitations, '坐标含义', report.coordinates.origin, report.coordinates.forward, report.coordinates.screen);
    return lines.join('\n');
}
