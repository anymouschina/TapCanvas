import type { PoseClip } from './state/poseClip'

export type Vec3 = [number, number, number]
export type Vec2 = [number, number] // XZ 地面坐标
export type AspectKey = 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'

export type CameraShot = {
  id: string
  name: string
  imageUrl: string
  serverAssetId?: string
  aspect: AspectKey
  createdAt: number
}

export type CharacterObj = {
  id: string
  name: string
  modelId: string
  position: Vec3
  rotation: Vec3
  scale: Vec3
  uniformScale: number
  colorHex: string
  hidden?: boolean
  locked?: boolean
  /** 群演分组：同一批阵列生成的角色共享 crowdId，场景树按组折叠、支持整组统一操作（state/crowd.ts） */
  crowdId?: string
  /** 群组显示名（如「群演 3×4」），组内所有成员一致 */
  crowdLabel?: string
  /** 姿势预设 id（POSE_PRESETS），agent 摆姿势的推荐入口；与 pose 同存时 pose 优先 */
  posePresetId?: string
  /** 关节角色 → 欧拉角(弧度)，由姿势系统写入 */
  pose?: Record<string, [number, number, number]>
  /** 骨骼动画 clip 名（MOTION_CLIP_OPTIONS）；设了则渲染样片时该角色循环播放此动作（优先于静态 pose） */
  motionClip?: string
  /** 连招序列：有序的动作预设 id（MOTION_PRESETS）。非空时角色循环播放这串预设首尾相接成的连续动作，
   *  由 CharacterObject 合成成一条 PoseClip，优先于 motionClip；与 motion 互斥（motion 设了仍优先）。 */
  motionSequence?: string[]
  /** 轻量动画：混合分层动作（上半身姿势关键帧 + 下半身 baked 位移 + 2D 路径根行进）。
   *  设了则优先于 motionClip/pose；定义见 state/characterMotion.ts。 */
  motion?: import('./state/characterMotion').CharacterMotion
}

/** 相机运动路径：在地面画 XZ 控制点，相机在 height 高度沿样条飞行，注视目标。 */
export type CameraPath = {
  waypoints: Vec2[]              // XZ 地面控制点
  mode: 'linear' | 'curve'      // 折线 / Catmull-Rom 曲线
  height?: number               // 飞行高度(米)，默认 1.6
  lookAtCharacterId?: string    // 注视角色；缺省注视场景中心
  lookAt?: Vec3                 // 显式注视点（优先于 character/center）
  closed?: boolean
}

export type CameraObj = {
  id: string
  name: string
  position: Vec3
  /** 绘制的相机运动路径；镜头 cameraMove 设为 'path' 时相机沿它飞（绘制见导演台相机面板）。 */
  path?: CameraPath
  /** 'manual' 表示用 lookAt 坐标，否则为某个 characterId（锁定该角色） */
  lookAtMode: 'manual' | string
  lookAt: Vec3
  fovDeg: number
  /** 焦距(mm，全画幅 36×24)。与 fovDeg 联动，编辑时两者同步写入；缺省时由 fovDeg 反算 */
  focalLengthMm?: number
  /** 光圈 f 值（电影感元数据，喂下游；不在 3D 视口做真实虚化） */
  apertureF?: number
  /** 对焦距离(m)，景深元数据 */
  focusDistance?: number
  /** 荷兰角：绕视轴的滚转(度)，真实施加到机位相机 */
  roll?: number
  hidden?: boolean
  locked?: boolean
}

export type DirectorScene = {
  characters: CharacterObj[]
  cameras: CameraObj[]
  aspect: AspectKey
  activeCameraId?: string
  /** 等距全景图 URL，作为 3D 场景天空盒背景 */
  skybox?: string
  /** 全景背景水平旋转(度, 0..360)：转动背景取景而不动机位；~2:1 走 equirect offset，非 2:1 转 backdrop 穹顶 */
  skyboxYaw?: number
  /** 全景地平线俯仰校准(度, -45..45)：让背景地面与 y=0 导演网格对齐 */
  skyboxPitch?: number
  /** 自定义动作库（小T 生成 / 人工保存），character.motionClip 可引用其 id；与内置 clip 并存 */
  customMotions?: PoseClip[]
  /** 全局多镜头时间线（动画化 blocking 的编排层）；缺省视为空时间线。定义见 state/timeline.ts */
  timeline?: import('./state/timeline').SceneTimeline
}

export type DirectorConsoleData = {
  kind: 'directorConsole'
  label: string
  scene: DirectorScene
  activeViewpoint: 'director' | 'camera'
  selectedObjectId?: string
  status?: 'idle' | 'running' | 'success' | 'error'
  // matches TaskNodeData pattern: allows ad-hoc canvas-node fields and store.updateNodeData(Record<string, any>) patches
  [key: string]: unknown
}

export function createDefaultDirectorConsoleData(_legacyPanoramaUrl?: string): DirectorConsoleData {
  return {
    kind: 'directorConsole',
    label: '导演台',
    scene: { characters: [], cameras: [], aspect: 'auto' },
    activeViewpoint: 'director',
    status: 'idle',
  }
}
