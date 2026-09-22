/**
 * 导演台节点数据。
 *
 * 三维编辑状态由嵌入的导演台（apps/director-desk）在自己的 IndexedDB 工程里持有，
 * 画布节点只保留入口所需的展示字段，因此这里不再有 scene / camera / character 结构。
 */
export type DirectorConsoleData = {
  kind: 'directorConsole'
  label: string
  /** 供画布与 agent 读取的执行状态；导演台自身运行在 iframe 内，这里只表示入口可用性 */
  status?: 'idle' | 'running' | 'success' | 'error'
  // 与 TaskNodeData 一致：允许画布写入 ad-hoc 字段，并兼容历史节点遗留的 scene 等数据
  [key: string]: unknown
}

export function createDefaultDirectorConsoleData(): DirectorConsoleData {
  return {
    kind: 'directorConsole',
    label: '导演台',
    status: 'idle',
  }
}
