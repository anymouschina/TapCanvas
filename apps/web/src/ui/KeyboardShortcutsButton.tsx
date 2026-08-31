import React from 'react'
import { ActionIcon, Popover, Tooltip, useMantineColorScheme } from '@mantine/core'
import { IconQuestionMark } from '@tabler/icons-react'

// 键盘快捷键说明按钮（原在 CanvasBottomControls 里独立浮动，2026-07-08 合并进底部 FloatingNav
// 控件栏、置于「个人管理/账户」按钮左侧）。自包含：数据 + 展示 + 触发全在此，供 FloatingNav 直接摆放。

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform)
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl'

// 仅列真实生效的快捷键（与 Canvas.tsx 的 keydown/paste 处理及 ReactFlow 默认键位一致）。
const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string[]; desc: string }> }> = [
  {
    title: '画布导航',
    items: [
      { keys: ['滚轮'], desc: '缩放画布' },
      { keys: ['中键 / 右键拖拽'], desc: '平移画布' },
      { keys: ['Space', '拖拽'], desc: '平移画布' },
      { keys: ['左键拖拽空白'], desc: '框选节点' },
      { keys: [MOD_KEY, '点击节点'], desc: '加选 / 减选节点' },
    ],
  },
  {
    title: '编辑',
    items: [
      { keys: ['Delete / ⌫'], desc: '删除所选节点与连线' },
      { keys: [MOD_KEY, 'V'], desc: '粘贴图片 / 工作流 JSON 到画布' },
      { keys: ['Esc'], desc: '关闭弹窗 / 输入框' },
    ],
  },
  {
    title: 'AI 对话',
    items: [
      { keys: ['Enter'], desc: '输入框内换行（点击按钮发送）' },
    ],
  },
]

function ShortcutKey({ text, isDark }: { text: string; isDark: boolean }) {
  return (
    <kbd
      style={{
        display: 'inline-block',
        padding: '2px 7px',
        borderRadius: 6,
        border: isDark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.14)',
        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        color: isDark ? 'rgba(235,237,242,0.92)' : 'rgba(20,22,26,0.85)',
        fontSize: 11,
        lineHeight: 1.5,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </kbd>
  )
}

export function KeyboardShortcutsButton(): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  return (
    <Popover opened={open} onChange={setOpen} position="top-end" offset={10} withinPortal shadow="md" radius={12}>
      <Popover.Target>
        <Tooltip label="键盘快捷键" position="top" withArrow disabled={open}>
          <ActionIcon
            className="floating-nav-item"
            variant="subtle"
            size={28}
            radius="md"
            aria-label="键盘快捷键"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            <IconQuestionMark size={18} stroke={2} />
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown
        style={{
          width: 332,
          padding: '14px 16px',
          background: isDark ? '#141519' : 'rgba(255,255,255,0.98)',
          border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.1)',
          color: isDark ? 'rgba(235,237,242,0.92)' : 'rgba(20,22,26,0.9)',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>键盘快捷键</div>
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.04em',
                marginBottom: 6,
                color: isDark ? 'rgba(150,156,168,0.85)' : 'rgba(90,97,108,0.85)',
              }}
            >
              {group.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {group.items.map((item) => (
                <div
                  key={`${group.title}_${item.desc}`}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                >
                  <span style={{ fontSize: 12, color: isDark ? 'rgba(200,204,212,0.9)' : 'rgba(40,44,52,0.9)' }}>
                    {item.desc}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {item.keys.map((key, idx) => (
                      <React.Fragment key={key}>
                        {idx > 0 ? <span style={{ fontSize: 10, opacity: 0.5 }}>+</span> : null}
                        <ShortcutKey text={key} isDark={isDark} />
                      </React.Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </Popover.Dropdown>
    </Popover>
  )
}

export default KeyboardShortcutsButton
