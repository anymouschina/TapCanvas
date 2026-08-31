export type PropShape =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'plane'
  | 'table' | 'low-table' | 'chair' | 'stool' | 'sofa' | 'bed' | 'cabinet' | 'sideboard' | 'shelf' | 'lamp'

export type LibraryItem =
  | { id: string; name: string; kind: 'body'; url: string; heightM: number; widthScale?: number }
  | { id: string; name: string; kind: 'prop'; shape: PropShape; defaultColor?: string }

// 自托管素体 GLB（标准 Mixamo 骨骼 X Bot，T-pose 绑定，见 public/director/ATTRIBUTION.md），可用环境变量覆盖为自有模型。
// 姿势系统按人形骨骼校准（pose.ts）：Mixamo 命名精确映射，其它命名走模糊匹配。
const GLB_A = import.meta.env.VITE_DIRECTOR_GLB_MALE || '/director/xbot.glb'
const GLB_B = import.meta.env.VITE_DIRECTOR_GLB_FEMALE || '/director/xbot.glb'

// 身型档：同一标准骨骼 GLB + 身高/体宽比例近似 liblib 的素体库（模型本体可后续换成自有 8 套）。
export const BODY_TYPES: LibraryItem[] = [
  { id: 'male', name: '男性素体', kind: 'body', url: GLB_A, heightM: 1.78 },
  { id: 'female', name: '女性素体', kind: 'body', url: GLB_B, heightM: 1.66, widthScale: 0.88 },
  { id: 'broad', name: '宽厚素体', kind: 'body', url: GLB_A, heightM: 1.74, widthScale: 1.28 },
  { id: 'muscular', name: '健壮素体', kind: 'body', url: GLB_A, heightM: 1.82, widthScale: 1.15 },
  { id: 'slim', name: '纤细素体', kind: 'body', url: GLB_B, heightM: 1.72, widthScale: 0.82 },
  { id: 'teen', name: '少年素体', kind: 'body', url: GLB_A, heightM: 1.5 },
  { id: 'child', name: '儿童素体', kind: 'body', url: GLB_A, heightM: 1.2 },
  { id: 'chibi', name: '二头身', kind: 'body', url: GLB_B, heightM: 1.0, widthScale: 1.2 },
]

export const PROP_TYPES: LibraryItem[] = [
  { id: 'prop-box', name: '立方体', kind: 'prop', shape: 'box' },
  { id: 'prop-sphere', name: '球体', kind: 'prop', shape: 'sphere' },
  { id: 'prop-cylinder', name: '圆柱', kind: 'prop', shape: 'cylinder' },
  { id: 'prop-cone', name: '圆锥', kind: 'prop', shape: 'cone' },
  { id: 'prop-plane', name: '平面', kind: 'prop', shape: 'plane' },
]

// 家具道具：程序化组合几何体（CharacterObject.tsx PropObject），blocking 占位风格，真实米制尺寸、底面落地 y=0。
export const FURNITURE_TYPES: LibraryItem[] = [
  { id: 'prop-table', name: '桌子', kind: 'prop', shape: 'table', defaultColor: '#A1795B' },
  { id: 'prop-low-table', name: '茶几', kind: 'prop', shape: 'low-table', defaultColor: '#A1795B' },
  { id: 'prop-chair', name: '椅子', kind: 'prop', shape: 'chair', defaultColor: '#B08968' },
  { id: 'prop-stool', name: '凳子', kind: 'prop', shape: 'stool', defaultColor: '#B08968' },
  { id: 'prop-sofa', name: '沙发', kind: 'prop', shape: 'sofa', defaultColor: '#76808F' },
  { id: 'prop-bed', name: '床', kind: 'prop', shape: 'bed', defaultColor: '#9FA8B8' },
  { id: 'prop-cabinet', name: '柜子', kind: 'prop', shape: 'cabinet', defaultColor: '#8B6F52' },
  { id: 'prop-sideboard', name: '矮柜', kind: 'prop', shape: 'sideboard', defaultColor: '#8B6F52' },
  { id: 'prop-shelf', name: '书架', kind: 'prop', shape: 'shelf', defaultColor: '#8B6F52' },
  { id: 'prop-lamp', name: '落地灯', kind: 'prop', shape: 'lamp', defaultColor: '#C9CDD6' },
]

export const LIBRARY: LibraryItem[] = [...BODY_TYPES, ...FURNITURE_TYPES, ...PROP_TYPES]

export function getLibraryItem(modelId: string): LibraryItem | undefined {
  const found = LIBRARY.find((m) => m.id === modelId)
  if (found) return found
  // 本地上传：modelId 直接是 blob/http URL
  if (/^(blob:|https?:)/.test(modelId)) {
    return { id: modelId, name: '上传素体', kind: 'body', url: modelId, heightM: 1.7 }
  }
  return undefined
}
