/**
 * 画布相关常量定义
 * 参考雅虎军规：常量集中管理，避免魔法数字
 */

// 画布配置
export const CANVAS_CONFIG = {
  // 布局配置
  GRID_SIZE: 20,
  NODE_SPACING_X: 200,
  NODE_SPACING_Y: 150,

  // 拖拽配置
  DRAG_THRESHOLD: 5,
  SCROLL_STEP: 100,

  // 选择配置
  SELECTION_THRESHOLD: 30,
  MULTI_SELECT_THRESHOLD: 10,

  // 性能配置
  MAX_HISTORY_LENGTH: 50,
  BATCH_UPDATE_DELAY: 100,
  RENDER_THRESHOLD: 500,

  // 动画配置
  ANIMATION_DURATION: 300,
  TRANSITION_EASING: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// 节点类型
export const NODE_TYPES = {
  TASK: 'taskNode',
  GROUP: 'groupNode',
  IO: 'ioNode',
} as const;

// 节点种类
export const NODE_KINDS = {
  TEXT: 'text',
  IMAGE: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  CHARACTER: 'character',
  SUBTITLE: 'subtitle',
  SUBFLOW: 'subflow',
  RUN: 'run',
  EMPTY: 'empty',
} as const;

// 边类型
export const EDGE_TYPES = {
  DEFAULT: 'default',
  SMOOTH: 'smooth',
  STEP: 'step',
  STRAIGHT: 'straight',
} as const;

// 颜色配置
export const COLORS = {
  // 类型颜色
  TYPE_COLORS: {
    image: '#3B82F6',
    audio: '#10B981',
    subtitle: '#EAB308',
    video: '#8B5CF6',
    text: '#6B7280',
    default: '#9CA3AF',
  },

  // 状态颜色
  STATUS_COLORS: {
    success: '#10B981',
    error: '#EF4444',
    warning: '#F59E0B',
    info: '#3B82F6',
    running: '#8B5CF6',
    pending: '#6B7280',
  },

  // 边颜色（半透明版本）
  EDGE_COLORS: {
    image: 'rgba(59,130,246,0.7)',
    audio: 'rgba(16,185,129,0.7)',
    subtitle: 'rgba(234,179,8,0.7)',
    video: 'rgba(139,92,246,0.7)',
    default: 'rgba(156,163,175,0.7)',
  },

  // 节点边框颜色
  NODE_BORDER_COLORS: {
    selected: '#3B82F6',
    focused: '#8B5CF6',
    group: '#10B981',
    default: '#E5E7EB',
  },
} as const;

// 手柄类型
export const HANDLE_TYPES = {
  SOURCE: 'source',
  TARGET: 'target',
} as const;

// 手柄前缀
export const HANDLE_PREFIXES = {
  INPUT: 'in-',
  OUTPUT: 'out-',
} as const;

// 快捷键配置
export const SHORTCUTS = {
  DELETE: ['Delete', 'Backspace'],
  COPY: 'Meta+C',
  PASTE: 'Meta+V',
  UNDO: 'Meta+Z',
  REDO: 'Meta+Shift+Z',
  SELECT_ALL: 'Meta+A',
  GROUP_SELECTED: 'Meta+G',
  UNGROUP_SELECTED: 'Meta+Shift+G',
  FOCUS_MODE: 'Meta+F',
  RUN_SELECTED: 'Meta+Enter',
  SAVE: 'Meta+S',
} as const;

// 本地存储键
export const STORAGE_KEYS = {
  CANVAS_DATA: 'tapCanvas-data',
  CANVAS_LAYOUT: 'tapCanvas-layout',
  USER_PREFERENCES: 'tapCanvas-preferences',
  RECENT_FILES: 'tapCanvas-recent',
} as const;

// 默认值
export const DEFAULTS = {
  NODE_WIDTH: 200,
  NODE_HEIGHT: 80,
  GROUP_NODE_WIDTH: 300,
  GROUP_NODE_HEIGHT: 200,
  IO_NODE_SIZE: 40,

  NODE_POSITION: { x: 0, y: 0 },
  NODE_DATA: {
    label: '',
    kind: NODE_KINDS.TEXT,
    config: {},
    progress: null,
    status: null,
  },

  EDGE_DATA: {
    type: null,
    label: '',
  },
} as const;

// 错误消息
export const ERROR_MESSAGES = {
  INVALID_NODE_TYPE: '节点类型无效',
  INVALID_EDGE_TYPE: '边类型无效',
  CONNECTION_FAILED: '连接失败',
  NODE_NOT_FOUND: '节点未找到',
  EDGE_NOT_FOUND: '边未找到',
  GROUP_NOT_FOUND: '分组未找到',
  VALIDATION_FAILED: '验证失败',
  EXECUTION_FAILED: '执行失败',
  NETWORK_ERROR: '网络错误',
  STORAGE_ERROR: '存储错误',
} as const;

// 成功消息
export const SUCCESS_MESSAGES = {
  NODE_CREATED: '节点创建成功',
  NODE_DELETED: '节点删除成功',
  EDGE_CREATED: '连接创建成功',
  EDGE_DELETED: '连接删除成功',
  GROUP_CREATED: '分组创建成功',
  GROUP_DELETED: '分组删除成功',
  LAYOUT_APPLIED: '布局应用成功',
  SAVED: '保存成功',
  EXECUTION_STARTED: '开始执行',
} as const;

// 文件类型
export const FILE_TYPES = {
  IMAGE: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
  VIDEO: ['mp4', 'webm', 'mov', 'avi'],
  AUDIO: ['mp3', 'wav', 'ogg', 'm4a'],
  SUBTITLE: ['srt', 'vtt', 'ass'],
} as const;

// API 端点
export const API_ENDPOINTS = {
  EXECUTE_NODE: '/api/execute-node',
  GET_NODE_RESULT: '/api/node-result',
  UPLOAD_FILE: '/api/upload',
  DOWNLOAD_FILE: '/api/download',
  VALIDATE_GRAPH: '/api/validate-graph',
} as const;

// 分页配置
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

// 验证规则
export const VALIDATION = {
  NODE_NAME_MAX_LENGTH: 50,
  NODE_LABEL_MAX_LENGTH: 100,
  GROUP_NAME_MAX_LENGTH: 50,
  MAX_NODES_PER_GROUP: 50,
  MAX_CONNECTIONS_PER_NODE: 10,
} as const;
