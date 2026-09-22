import type { Waypoint } from '../model.ts';
import { stopsAtPoint } from '../animation/continuous-path.ts';

export const pathMotionChoices: Array<[string, string]> = [['segmented', '分段曲线'], ['continuous', '连贯运动']];
export const waypointMotionChoices: Array<[string, string]> = [['pass', '经过'], ['stop', '停住']];
export const continuousMotionHelp = '连贯运动替换各段速度曲线，按点位和时间平顺移动。端点默认停住，中间点默认经过；相同坐标仍可停留。';

export function waypointMotionValue(points: Waypoint[], index: number) {
    return (points[index] ? stopsAtPoint(points, index) : true) ? 'stop' : 'pass';
}

/** A user-requested mode change replaces incompatible segment curves in the caller's transaction. */
export function setPathMotionMode(path: { interpolation?: 'continuous'; points: Waypoint[] }, value: string) {
    if (value === 'continuous') {
        path.interpolation = 'continuous';
        path.points.forEach(point => { delete point.easing; });
    } else delete path.interpolation;
}
