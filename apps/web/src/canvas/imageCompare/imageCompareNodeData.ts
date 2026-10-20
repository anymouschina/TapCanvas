/**
 * 图片对比节点数据。
 *
 * 节点不保存图片本身：输入图片始终从入边上游的图片节点实时读取，
 * 上游换主图/重新生成后对比内容自动跟随。节点只持有展示偏好与尺寸。
 */
export type ImageCompareMode = 'side' | 'slider' | 'overlay' | 'toggle'

export type ImageCompareNodeData = {
  kind: 'imageCompare'
  label: string
  compareMode?: ImageCompareMode
  /** 滑动模式分割位置，0-100 */
  splitPercent?: number
  /** 叠加模式上层（图 2）不透明度，0-100 */
  overlayOpacity?: number
  nodeWidth?: number
  nodeHeight?: number
  // 与 TaskNodeData 一致：允许画布写入 ad-hoc 字段（readOnly 等）
  [key: string]: unknown
}

export const IMAGE_COMPARE_NODE_TYPE = 'imageCompare'
export const IMAGE_COMPARE_TARGET_HANDLE_ID = 'in-image'
export const IMAGE_COMPARE_DEFAULT_SIZE = Object.freeze({ width: 480, height: 320 })
export const IMAGE_COMPARE_MIN_SIZE = Object.freeze({ width: 320, height: 220 })
export const IMAGE_COMPARE_MAX_SIZE = Object.freeze({ width: 1600, height: 1200 })

export function createDefaultImageCompareData(): ImageCompareNodeData {
  return {
    kind: 'imageCompare',
    label: '对比节点',
    compareMode: 'side',
    splitPercent: 50,
    overlayOpacity: 50,
    nodeWidth: IMAGE_COMPARE_DEFAULT_SIZE.width,
    nodeHeight: IMAGE_COMPARE_DEFAULT_SIZE.height,
  }
}
