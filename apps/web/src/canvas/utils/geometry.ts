/**
 * 几何计算工具函数
 * 参考雅虎军规：数学计算封装，性能优化，精度保证
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Circle {
  x: number;
  y: number;
  radius: number;
}

/**
 * 计算两点之间的距离
 * @param p1 点1
 * @param p2 点2
 * @returns 欧几里得距离
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算两点之间的曼哈顿距离
 * @param p1 点1
 * @param p2 点2
 * @returns 曼哈顿距离
 */
export function manhattanDistance(p1: Point, p2: Point): number {
  return Math.abs(p2.x - p1.x) + Math.abs(p2.y - p1.y);
}

/**
 * 计算点到线段的距离
 * @param point 点
 * @param lineStart 线段起点
 * @param lineEnd 线段终点
 * @returns 点到线段的距离
 */
export function pointToLineDistance(
  point: Point,
  lineStart: Point,
  lineEnd: Point
): number {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  if (lenSq === 0) {
    return distance(point, lineStart);
  }

  let param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  return distance(point, { x: xx, y: yy });
}

/**
 * 检查点是否在矩形内
 * @param point 点
 * @param rect 矩形
 * @param inclusive 是否包含边界
 * @returns 是否在矩形内
 */
export function pointInRectangle(
  point: Point,
  rect: Rectangle,
  inclusive: boolean = true
): boolean {
  if (inclusive) {
    return (
      point.x >= rect.x &&
      point.x <= rect.x + rect.width &&
      point.y >= rect.y &&
      point.y <= rect.y + rect.height
    );
  } else {
    return (
      point.x > rect.x &&
      point.x < rect.x + rect.width &&
      point.y > rect.y &&
      point.y < rect.y + rect.height
    );
  }
}

/**
 * 检查点是否在圆内
 * @param point 点
 * @param circle 圆
 * @param inclusive 是否包含边界
 * @returns 是否在圆内
 */
export function pointInCircle(
  point: Point,
  circle: Circle,
  inclusive: boolean = true
): boolean {
  const dist = distance(point, circle);
  return inclusive ? dist <= circle.radius : dist < circle.radius;
}

/**
 * 检查两个矩形是否相交
 * @param rect1 矩形1
 * @param rect2 矩形2
 * @returns 是否相交
 */
export function rectanglesIntersect(rect1: Rectangle, rect2: Rectangle): boolean {
  return !(
    rect1.x + rect1.width < rect2.x ||
    rect2.x + rect2.width < rect1.x ||
    rect1.y + rect1.height < rect2.y ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * 计算两个矩形的交集
 * @param rect1 矩形1
 * @param rect2 矩形2
 * @returns 交集矩形，如果不相交返回null
 */
export function rectangleIntersection(
  rect1: Rectangle,
  rect2: Rectangle
): Rectangle | null {
  const x = Math.max(rect1.x, rect2.x);
  const y = Math.max(rect1.y, rect2.y);
  const width = Math.min(rect1.x + rect1.width, rect2.x + rect2.width) - x;
  const height = Math.min(rect1.y + rect1.height, rect2.y + rect2.height) - y;

  if (width < 0 || height < 0) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * 计算包含多个点的最小边界矩形
 * @param points 点数组
 * @param padding 边距
 * @returns 边界矩形
 */
export function boundingRectangle(
  points: Point[],
  padding: number = 0
): Rectangle {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

/**
 * 计算两点之间的角度（弧度）
 * @param from 起始点
 * @param to 终点
 * @returns 角度（弧度）
 */
export function angle(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * 将角度从弧度转换为度数
 * @param radians 弧度
 * @returns 度数
 */
export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * 将角度从度数转换为弧度
 * @param degrees 度数
 * @returns 弧度
 */
export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * 旋转点
 * @param point 原始点
 * @param center 旋转中心
 * @param angle 旋转角度（弧度）
 * @returns 旋转后的点
 */
export function rotatePoint(
  point: Point,
  center: Point,
  angle: number
): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/**
 * 缩放点
 * @param point 原始点
 * @param center 缩放中心
 * @param scale 缩放比例
 * @returns 缩放后的点
 */
export function scalePoint(
  point: Point,
  center: Point,
  scale: number
): Point {
  return {
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  };
}

/**
 * 在两点之间插值
 * @param p1 起点
 * @param p2 终点
 * @param t 插值参数 (0-1)
 * @returns 插值点
 */
export function lerp(p1: Point, p2: Point, t: number): Point {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

/**
 * 计算贝塞尔曲线上的点
 * @param t 参数 (0-1)
 * @param controlPoints 控制点数组
 * @returns 贝塞尔曲线上的点
 */
export function bezierPoint(t: number, controlPoints: Point[]): Point {
  if (controlPoints.length === 0) {
    return { x: 0, y: 0 };
  }

  if (controlPoints.length === 1) {
    return controlPoints[0];
  }

  const points: Point[] = [];
  for (let i = 0; i < controlPoints.length - 1; i++) {
    points.push(lerp(controlPoints[i], controlPoints[i + 1], t));
  }

  return bezierPoint(t, points);
}

/**
 * 计算贝塞尔曲线的长度（近似）
 * @param controlPoints 控制点数组
 * @param samples 采样点数
 * @returns 曲线长度的近似值
 */
export function bezierLength(
  controlPoints: Point[],
  samples: number = 100
): number {
  if (controlPoints.length < 2) {
    return 0;
  }

  let length = 0;
  let previousPoint = controlPoints[0];

  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const currentPoint = bezierPoint(t, controlPoints);
    length += distance(previousPoint, currentPoint);
    previousPoint = currentPoint;
  }

  return length;
}

/**
 * 将点约束在矩形内
 * @param point 点
 * @param rect 矩形
 * @returns 约束后的点
 */
export function constrainPointToRectangle(point: Point, rect: Rectangle): Point {
  return {
    x: Math.max(rect.x, Math.min(point.x, rect.x + rect.width)),
    y: Math.max(rect.y, Math.min(point.y, rect.y + rect.height)),
  };
}

/**
 * 检查多边形是否包含点
 * @param point 点
 * @param polygon 多边形顶点数组
 * @returns 是否包含点
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;

    const intersect = ((yi > point.y) !== (yj > point.y))
      && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * 计算多边形的面积
 * @param polygon 多边形顶点数组
 * @returns 面积
 */
export function polygonArea(polygon: Point[]): number {
  let area = 0;
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += polygon[i].x * polygon[j].y;
    area -= polygon[j].x * polygon[i].y;
  }

  return Math.abs(area / 2);
}