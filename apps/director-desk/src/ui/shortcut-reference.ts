import { escape } from './common.ts';
const groups: [string,[string,string][]][] = [
    ['通用', [['Ctrl / ⌘ + S','保存工程'],['Ctrl / ⌘ + Z','撤销'],['Ctrl / ⌘ + Shift + Z','重做'],['空格','播放 / 暂停'],['/','搜索对象或资产']]],
    ['对象编辑', [['1 / 2 / 3','移动 / 旋转 / 缩放'],['Ctrl / ⌘ + D','复制选中对象'],['K','记录当前位置关键帧'],['Delete','删除选中对象或时间轴片段'],['Enter / Esc','完成 / 取消路径绘制']]],
    ['布景视角 · 先点击布景', [['W A S D','前后左右移动'],['Q / E','左右转向'],['R / F','上升 / 下降'],['Shift','加速移动'],['鼠标左拖 / 右拖 / 滚轮','环绕 / 平移 / 拉近拉远']]],
    ['时间轴', [['Ctrl / ⌘ + 点击','追加 / 取消选择片段'],['Ctrl / ⌘ + 拖时间尺','选择时间范围'],['← / →','上一帧 / 下一帧'],['Ctrl / ⌘ + B','在播放头处分割选中的片段'],['Alt + ↑ / ↓','聚焦轨道手柄后上移 / 下移轨道'],['Esc','取消当前拖动']]],
];
export const shortcutReference = () => '<div class="shortcut-reference">'+groups.map(([title,rows])=>`<section><h3>${escape(title)}</h3>${rows.map(([keys,action])=>`<div class="shortcut-row"><span>${escape(action)}</span><kbd>${escape(keys)}</kbd></div>`).join('')}</section>`).join('')+'</div>';
