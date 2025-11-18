/**
 * 简单的国际化系统
 * 默认中文，提供英文翻译
 * 使用方式：$('首页') -> "首页" 或 "Home"
 */

// 英文翻译包
const enTranslations = {
  // 通用词汇
  '确定': 'OK',
  '取消': 'Cancel',
  '保存': 'Save',
  '删除': 'Delete',
  '编辑': 'Edit',
  '复制': 'Copy',
  '粘贴': 'Paste',
  '运行': 'Run',
  '停止': 'Stop',
  '配置': 'Configure',
  '重试': 'Retry',
  '加载中': 'Loading',
  '成功': 'Success',
  '失败': 'Error',
  '警告': 'Warning',
  '信息': 'Info',
  '设置': 'Settings',
  '帮助': 'Help',
  '关于': 'About',
  '版本': 'Version',
  '作者': 'Author',
  '描述': 'Description',
  '名称': 'Name',
  '标题': 'Title',
  '类型': 'Type',
  '状态': 'Status',
  '进度': 'Progress',
  '创建时间': 'Created',
  '修改时间': 'Modified',
  '大小': 'Size',
  '时长': 'Duration',
  '数量': 'Count',
  '总计': 'Total',
  '搜索': 'Search',
  '筛选': 'Filter',
  '排序': 'Sort',
  '选择': 'Select',
  '全选': 'Select All',
  '清空': 'Clear',
  '重置': 'Reset',
  '默认': 'Default',
  '自定义': 'Custom',
  '高级': 'Advanced',
  '基础': 'Basic',
  '通用': 'General',
  '导出': 'Export',
  '导入': 'Import',
  '上传': 'Upload',
  '下载': 'Download',
  '分享': 'Share',
  '预览': 'Preview',
  '全屏': 'Fullscreen',
  '退出全屏': 'Exit Fullscreen',
  '展开': 'Expand',
  '折叠': 'Collapse',
  '显示': 'Show',
  '隐藏': 'Hide',
  '启用': 'Enable',
  '禁用': 'Disable',
  '开始': 'Start',
  '结束': 'End',
  '第一个': 'First',
  '最后一个': 'Last',
  '上一个': 'Previous',
  '下一个': 'Next',
  '页': 'Page',
  '共': 'of',
  '项': 'Items',
  '更多': 'More',
  '更少': 'Less',
  '和': 'And',
  '或': 'Or',
  '未知': 'Unknown',
  '空': 'Empty',
  '无': 'None',
  '全部': 'All',
  '任何': 'Any',
  '其他': 'Other',
  '新建': 'New',
  '已用': 'Used',
  '推荐': 'Recommended',
  '可选': 'Optional',
  '必填': 'Required',
  '自动': 'Auto',
  '手动': 'Manual',

  // 节点相关
  '文本节点': 'Text Node',
  '图像节点': 'Image Node',
  '视频节点': 'Video Node',
  '音频节点': 'Audio Node',
  '字幕节点': 'Subtitle Node',
  '子流节点': 'Subflow Node',
  '运行节点': 'Run Node',
  '空节点': 'Empty Node',
  '分组节点': 'Group Node',
  '输入节点': 'Input Node',
  '输出节点': 'Output Node',

  // 节点状态
  '空闲': 'Idle',
  '排队中': 'Queued',
  '运行中': 'Running',
  '已完成': 'Completed',
  '错误': 'Error',
  '已取消': 'Canceled',
  '失败': 'Failed',
  '等待中': 'Pending',
  '处理中': 'Processing',

  // 节点操作
  '添加节点': 'Add Node',
  '创建节点': 'Create Node',
  '配置节点': 'Configure Node',
  '执行节点': 'Execute Node',
  '复制节点': 'Duplicate Node',
  '删除节点': 'Delete Node',
  '分组': 'Group',
  '取消分组': 'Ungroup',
  '连接': 'Connect',
  '断开连接': 'Disconnect',
  '聚焦': 'Focus',
  '选中': 'Select',
  '取消选中': 'Deselect',

  // 节点配置
  '节点配置': 'Node Configuration',
  '基础配置': 'Basic Configuration',
  '高级配置': 'Advanced Configuration',
  '参数': 'Parameters',
  '选项': 'Options',
  '验证': 'Validation',
  '提示词': 'Prompt',
  '温度': 'Temperature',
  '最大长度': 'Max Length',
  '尺寸': 'Size',
  '质量': 'Quality',
  '分辨率': 'Resolution',
  '帧率': 'Frame Rate',
  '时长': 'Duration',
  '语言': 'Language',
  '格式': 'Format',

  // 边相关
  '平滑边': 'Smooth Edge',
  '直角边': 'Orthogonal Edge',
  '默认边': 'Default Edge',
  '贝塞尔边': 'Bezier Edge',
  '有效连接': 'Valid Connection',
  '无效连接': 'Invalid Connection',
  '连接中': 'Connecting',
  '已连接': 'Connected',
  '已断开': 'Disconnected',

  // 画布相关
  '画布': 'Canvas',
  '空画布': 'Empty Canvas',
  '拖拽节点到这里开始创作': 'Drag nodes here to start creating',
  '缩放': 'Zoom',
  '放大': 'Zoom In',
  '缩小': 'Zoom Out',
  '适应屏幕': 'Fit to Screen',
  '重置缩放': 'Reset Zoom',
  '网格': 'Grid',
  '显示网格': 'Show Grid',
  '隐藏网格': 'Hide Grid',
  '网格吸附': 'Snap to Grid',
  '网格大小': 'Grid Size',
  '选择': 'Selection',
  '单选': 'Single Selection',
  '多选': 'Multiple Selection',
  '清除选择': 'Clear Selection',
  '全选': 'Select All',
  '反选': 'Invert Selection',
  '布局': 'Layout',
  '自动布局': 'Auto Layout',
  '网格布局': 'Grid Layout',
  '层级布局': 'Hierarchical Layout',
  '径向布局': 'Radial Layout',
  '力导向布局': 'Force Directed Layout',
  '左对齐': 'Align Left',
  '居中对齐': 'Align Center',
  '右对齐': 'Align Right',
  '顶部对齐': 'Align Top',
  '底部对齐': 'Align Bottom',
  '水平分布': 'Distribute Horizontally',
  '垂直分布': 'Distribute Vertically',
  '历史': 'History',
  '撤销': 'Undo',
  '重做': 'Redo',
  '清除历史': 'Clear History',
  '剪贴板': 'Clipboard',
  '剪切': 'Cut',
  '复制': 'Copy',
  '粘贴': 'Paste',
  '复制配置': 'Copy Configuration',
  '粘贴配置': 'Paste Configuration',
  '右键菜单': 'Context Menu',
  '节点': 'Nodes',
  '边': 'Edges',
  '画布设置': 'Canvas Settings',
  '属性': 'Properties',

  // 工具栏
  '工具栏': 'Toolbar',
  '添加': 'Add',
  '移除': 'Remove',
  '修改': 'Modify',
  '验证': 'Validate',
  '运行选中': 'Run Selected',
  '停止运行': 'Stop Running',

  // 错误信息
  '错误': 'Error',
  '未知错误': 'Unknown Error',
  '网络错误': 'Network Error',
  '超时错误': 'Timeout Error',
  '权限错误': 'Permission Error',
  '未找到': 'Not Found',
  '数据无效': 'Invalid Data',
  '验证失败': 'Validation Failed',
  '配额已满': 'Quota Exceeded',
  '请求频率限制': 'Rate Limited',
  '节点未找到': 'Node Not Found',
  '节点类型无效': 'Invalid Node Type',
  '节点配置无效': 'Invalid Node Configuration',
  '节点执行失败': 'Node Execution Failed',
  '连接失败': 'Connection Failed',
  '缺少输入': 'Missing Input',
  '输出无效': 'Invalid Output',
  '连接数过多': 'Too Many Connections',
  '循环依赖': 'Circular Dependency',
  '边未找到': 'Edge Not Found',
  '无效连接': 'Invalid Connection',
  '类型不兼容': 'Incompatible Types',
  '自连接': 'Self Connection',
  '重复连接': 'Duplicate Connection',
  '保存失败': 'Save Failed',
  '加载失败': 'Load Failed',
  '导入失败': 'Import Failed',
  '导出失败': 'Export Failed',
  '数据损坏': 'Data Corrupted',
  '版本不匹配': 'Version Mismatch',
  '文件过大': 'File Too Large',
  '不支持的文件类型': 'Unsupported File Type',
  '文件上传失败': 'File Upload Failed',
  '文件下载失败': 'File Download Failed',

  // 成功信息
  '成功': 'Success',
  '已保存': 'Saved',
  '已加载': 'Loaded',
  '已导入': 'Imported',
  '已导出': 'Exported',
  '已复制': 'Copied',
  '已粘贴': 'Pasted',
  '已删除': 'Deleted',
  '已更新': 'Updated',
  '已创建': 'Created',
  '已完成': 'Completed',
  '节点已创建': 'Node Created',
  '节点已删除': 'Node Deleted',
  '节点已更新': 'Node Updated',
  '节点已执行': 'Node Executed',
  '节点已配置': 'Node Configured',
  '节点已复制': 'Node Duplicated',
  '节点已分组': 'Node Grouped',
  '分组已取消': 'Node Ungrouped',
  '边已创建': 'Edge Created',
  '边已删除': 'Edge Deleted',
  '边已更新': 'Edge Updated',
  '画布已保存': 'Canvas Saved',
  '画布已加载': 'Canvas Loaded',
  '画布已清空': 'Canvas Cleared',
  '布局已应用': 'Layout Applied',
  '选择已清空': 'Selection Cleared',

  // 时间相关
  '刚刚': 'Just Now',
  '很快': 'Soon',
  '分钟前': '{{count}} Minutes Ago',
  '分钟后': '{{count}} Minutes Later',
  '小时前': '{{count}} Hours Ago',
  '小时后': '{{count}} Hours Later',
  '天前': '{{count}} Days Ago',
  '天后': '{{count}} Days Later',
  '周前': '{{count}} Weeks Ago',
  '周后': '{{count}} Weeks Later',
  '月前': '{{count}} Months Ago',
  '月后': '{{count}} Months Later',
  '年前': '{{count}} Years Ago',
  '年后': '{{count}} Years Later',
  '秒': 's',
  '分钟': 'm',
  '小时': 'h',
  '天': 'd',
  '周': 'w',
  '月': 'mo',
  '年': 'y',
  '前': ' ago',
  '后': ' later',

  // 文件相关
  '图片': 'Image',
  '视频': 'Video',
  '音频': 'Audio',
  '文本': 'Text',
  'JSON文件': 'JSON File',
  'CSV文件': 'CSV File',
  'PDF文件': 'PDF File',
  'ZIP文件': 'ZIP File',
  '未知文件': 'Unknown File',
  '文件上传中': 'Uploading',
  '文件下载中': 'Downloading',
  '文件处理中': 'Processing',
  '文件完成': 'Completed',
  '文件失败': 'Failed',
  '文件等待中': 'Pending',
  '文件类型': 'File Type',
  '文件大小': 'File Size',
  '文件状态': 'File Status',
  '字节': 'B',
  'KB': 'KB',
  'MB': 'MB',
  'GB': 'GB',
  'TB': 'TB',

  // 模态框
  '节点配置': 'Node Configuration',
  '导出画布': 'Export Canvas',
  '导入画布': 'Import Canvas',
  '设置': 'Settings',
  '关于': 'About',
  '删除确认': 'Delete Confirmation',
  '文件': 'File',
  '格式': 'Format',
  '选项': 'Options',
  '文件名': 'Filename',
  '语言': 'Language',
  '外观': 'Appearance',
  '通用': 'General',
  '高级': 'Advanced',
  '重置': 'Reset',
  '警告': 'Warning',
  '确认删除': 'Confirm Delete',
  '此操作不可恢复': 'This action cannot be undone',
  '确定要删除吗': 'Are you sure you want to delete',

  // 快捷键
  '快捷键': 'Shortcuts',
  '常规快捷键': 'General Shortcuts',
  '导航快捷键': 'Navigation Shortcuts',
  '编辑快捷键': 'Editing Shortcuts',
  '选择快捷键': 'Selection Shortcuts',
  '画布快捷键': 'Canvas Shortcuts',
  '节点快捷键': 'Node Shortcuts',
  '边快捷键': 'Edge Shortcuts',
  'Ctrl键': 'Ctrl',
  'Alt键': 'Alt',
  'Shift键': 'Shift',
  'Meta键': 'Cmd',
  '空格键': 'Space',
  '回车键': 'Enter',
  'ESC键': 'Escape',
  'Tab键': 'Tab',
  '退格键': 'Backspace',
  '删除键': 'Delete',
  '上箭头': 'Up Arrow',
  '下箭头': 'Down Arrow',
  '左箭头': 'Left Arrow',
  '右箭头': 'Right Arrow',
  '功能键': 'F',
  '保存': 'Save',
  '加载': 'Load',
  '导出': 'Export',
  '导入': 'Import',
  '撤销': 'Undo',
  '重做': 'Redo',
  '剪切': 'Cut',
  '复制': 'Copy',
  '粘贴': 'Paste',
  '复制': 'Duplicate',
  '删除': 'Delete',
  '全选': 'Select All',
  '清空选择': 'Clear Selection',
  '查找': 'Find',
  '替换': 'Replace',
  '放大': 'Zoom In',
  '缩小': 'Zoom Out',
  '适应屏幕': 'Fit to Screen',
  '全屏': 'Fullscreen',
  '帮助': 'Help',
  '设置': 'Settings',

  // 提示信息
  '放大画布': 'Zoom In Canvas',
  '缩小画布': 'Zoom Out Canvas',
  '适应屏幕': 'Fit to Screen',
  '显示网格': 'Show Grid',
  '隐藏网格': 'Hide Grid',
  '网格吸附': 'Snap to Grid',
  '自动布局': 'Auto Layout',
  '全选': 'Select All',
  '清除选择': 'Clear Selection',
  '撤销': 'Undo',
  '重做': 'Redo',
  '添加节点': 'Add Node',
  '删除节点': 'Delete Node',
  '配置节点': 'Configure Node',
  '复制节点': 'Duplicate Node',
  '分组节点': 'Group Nodes',
  '聚焦节点': 'Focus Nodes',
  '运行节点': 'Run Node',
  '停止节点': 'Stop Node',
  '添加边': 'Add Edge',
  '删除边': 'Delete Edge',
  '修改边': 'Modify Edge',
  '运行': 'Run',
  '停止': 'Stop',
  '配置': 'Configure',
  '复制配置': 'Copy Configuration',
  '粘贴配置': 'Paste Configuration',
  '复制节点': 'Duplicate Node',
  '删除节点': 'Delete Node',
  '分组': 'Group',
  '取消分组': 'Ungroup',
  '聚焦': 'Focus',
};

// 当前语言
let currentLanguage: 'zh' | 'en' = 'zh';

/**
 * 获取当前语言
 */
export function getCurrentLanguage(): 'zh' | 'en' {
  return currentLanguage;
}

/**
 * 设置当前语言
 */
export function setLanguage(lang: 'zh' | 'en'): void {
  currentLanguage = lang;
  // 保存到本地存储
  if (typeof window !== 'undefined') {
    localStorage.setItem('tapcanvas-language', lang);
  }
}

/**
 * 初始化语言设置
 */
export function initLanguage(): void {
  if (typeof window !== 'undefined') {
    // 检查本地存储
    const saved = localStorage.getItem('tapcanvas-language') as 'zh' | 'en';
    if (saved && (saved === 'zh' || saved === 'en')) {
      currentLanguage = saved;
      return;
    }

    // 检查浏览器语言
    const browserLang = navigator.language;
    if (browserLang.startsWith('en')) {
      currentLanguage = 'en';
    }
  }
}

/**
 * 国际化翻译函数
 * @param text 中文文本
 * @returns 翻译后的文本
 */
export function $(text: string): string {
  if (currentLanguage === 'en' && enTranslations[text as keyof typeof enTranslations]) {
    return enTranslations[text as keyof typeof enTranslations];
  }
  return text;
}

/**
 * 参数插值翻译
 * @param text 包含{{变量}}的文本
 * @param params 参数对象
 * @returns 插值后的文本
 */
export function $t(text: string, params?: Record<string, string | number>): string {
  let result = $(text);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    });
  }

  return result;
}

/**
 * React Hook
 */
export function useI18n() {
  return {
    $,
    $t,
    currentLanguage,
    setLanguage,
    isEn: currentLanguage === 'en',
    isZh: currentLanguage === 'zh',
  };
}

// 初始化语言
initLanguage();