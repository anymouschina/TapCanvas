import React from 'react'
import { IconVideo, IconUser, IconUsers, IconEye, IconEyeOff, IconLock, IconLockOpen, IconChevronDown, IconChevronRight, IconTrash } from '@tabler/icons-react'
import type { DirectorScene, CharacterObj } from '../types'

type Row = { id: string; name: string; kind: 'camera' | 'character'; hidden?: boolean; locked?: boolean }

type Props = {
  scene: DirectorScene
  selectedId?: string
  onSelect: (id: string) => void
  onToggleHidden: (id: string, hidden: boolean) => void
  onToggleLocked: (id: string, locked: boolean) => void
  /** 群组操作（群演阵列）：整组隐藏/删除 */
  onToggleCrowdHidden?: (crowdId: string, hidden: boolean) => void
  onRemoveCrowd?: (crowdId: string) => void
}

export function SceneTreePanel({ scene, selectedId, onSelect, onToggleHidden, onToggleLocked, onToggleCrowdHidden, onRemoveCrowd }: Props) {
  const [q, setQ] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const match = (name: string) => !q || name.toLowerCase().includes(q.toLowerCase())

  const soloRows: Row[] = [
    ...scene.cameras.map((c): Row => ({ id: c.id, name: c.name, kind: 'camera', hidden: c.hidden, locked: c.locked })),
    ...scene.characters.filter((c) => !c.crowdId).map((c): Row => ({ id: c.id, name: c.name, kind: 'character', hidden: c.hidden, locked: c.locked })),
  ].filter((r) => match(r.name))

  // 群演按 crowdId 分组折叠；搜索时匹配组名或成员名
  const crowds = React.useMemo(() => {
    const byId = new Map<string, CharacterObj[]>()
    for (const c of scene.characters) {
      if (!c.crowdId) continue
      const list = byId.get(c.crowdId) ?? []
      list.push(c)
      byId.set(c.crowdId, list)
    }
    return [...byId.entries()].map(([crowdId, members]) => ({
      crowdId,
      label: members[0]?.crowdLabel ?? '群演',
      members,
    }))
  }, [scene.characters])

  const renderRow = (r: Row, indent = 0) => {
    const active = r.id === selectedId
    return (
      <div key={r.id} onClick={() => onSelect(r.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `8px 16px 8px ${16 + indent}px`, cursor: 'pointer', background: active ? '#1c2230' : 'transparent' }}>
        {r.kind === 'camera' ? <IconVideo size={16} color="#9ca3af" /> : <IconUser size={16} color="#9ca3af" />}
        <span style={{ flex: 1, fontSize: 13, color: r.hidden ? '#5b6470' : '#cdd3dc' }}>{r.name}</span>
        <button onClick={(e) => { e.stopPropagation(); onToggleHidden(r.id, !r.hidden) }} style={iconBtn} title="隐藏">
          {r.hidden ? <IconEyeOff size={14} color="#6b7280" /> : <IconEye size={14} color="#9ca3af" />}
        </button>
        <button onClick={(e) => { e.stopPropagation(); onToggleLocked(r.id, !r.locked) }} style={iconBtn} title="锁定">
          {r.locked ? <IconLock size={14} color="#6b7280" /> : <IconLockOpen size={14} color="#9ca3af" />}
        </button>
      </div>
    )
  }

  const empty = soloRows.length === 0 && crowds.every((g) => !match(g.label) && g.members.every((m) => !match(m.name)))

  return (
    <div>
      <div style={{ padding: '14px 16px', fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>场景</div>
      <div style={{ padding: '0 16px 8px' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="请输入搜索内容"
          style={{ width: '100%', background: '#1c1f26', border: '1px solid #2a2f3a', borderRadius: 8, color: '#e5e7eb', padding: '7px 10px', fontSize: 13, boxSizing: 'border-box' }} />
      </div>
      <div>
        {soloRows.map((r) => renderRow(r))}
        {crowds.map((g) => {
          const visibleMembers = g.members.filter((m) => match(g.label) || match(m.name))
          if (visibleMembers.length === 0) return null
          const isCollapsed = collapsed[g.crowdId] ?? true
          const allHidden = g.members.every((m) => m.hidden)
          const hasSelected = g.members.some((m) => m.id === selectedId)
          return (
            <div key={g.crowdId}>
              <div onClick={() => setCollapsed((c) => ({ ...c, [g.crowdId]: !isCollapsed }))}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', cursor: 'pointer', background: hasSelected && isCollapsed ? '#1c2230' : 'transparent' }}>
                {isCollapsed ? <IconChevronRight size={14} color="#6b7280" /> : <IconChevronDown size={14} color="#6b7280" />}
                <IconUsers size={16} color="#9ca3af" />
                <span style={{ flex: 1, fontSize: 13, color: allHidden ? '#5b6470' : '#cdd3dc', fontWeight: 600 }}>
                  {g.label} <span style={{ color: '#5b6470', fontWeight: 400 }}>({g.members.length})</span>
                </span>
                {onToggleCrowdHidden ? (
                  <button onClick={(e) => { e.stopPropagation(); onToggleCrowdHidden(g.crowdId, !allHidden) }} style={iconBtn} title={allHidden ? '整组显示' : '整组隐藏'}>
                    {allHidden ? <IconEyeOff size={14} color="#6b7280" /> : <IconEye size={14} color="#9ca3af" />}
                  </button>
                ) : null}
                {onRemoveCrowd ? (
                  <button onClick={(e) => { e.stopPropagation(); onRemoveCrowd(g.crowdId) }} style={iconBtn} title="删除整组">
                    <IconTrash size={14} color="#9b6b6b" />
                  </button>
                ) : null}
              </div>
              {!isCollapsed
                ? visibleMembers.map((m) => renderRow({ id: m.id, name: m.name, kind: 'character', hidden: m.hidden, locked: m.locked }, 18))
                : null}
            </div>
          )
        })}
        {empty ? <div style={{ padding: '12px 16px', color: '#5b6470', fontSize: 12 }}>暂无场景对象</div> : null}
      </div>
    </div>
  )
}

const iconBtn: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', padding: 2, display: 'flex' }
