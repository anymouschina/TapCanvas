import React from 'react'
import type { WorkflowNodeRunDto } from '../../api/server'
import { buildTimeline, durationLabel } from './model'

export function ExecutionWaterfall({ runs, labels, onSelect }: {
  runs: readonly WorkflowNodeRunDto[]; labels: Readonly<Record<string, string>>; onSelect: (nodeId: string) => void
}): React.JSX.Element {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    if (!runs.some((r) => r.status === 'running' || r.status === 'queued' || r.status === 'waiting_external')) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [runs])
  const model = React.useMemo(() => buildTimeline(runs, now), [runs, now])
  return <section className="execution-insights" aria-label="节点耗时瀑布图">
    <p className="execution-waterfall__p">灰色：排队 · 蓝色：执行起止区间（含外部等待）· 条纹：尚未结束。点击节点查看数据。</p>
    <p className="execution-waterfall__p">{model.origin === null ? '未记录时间轴' : `${new Date(model.origin).toLocaleString()} → ${new Date(model.end!).toLocaleString()}`}</p>
    {runs.length === 0 && <p className="execution-waterfall__p">暂无节点运行数据</p>}
    {model.rows.map((row) => <div className="execution-insights__time-row" key={row.run.id}>
      <button className="execution-waterfall__button" type="button" onClick={() => onSelect(row.run.nodeId)}>{labels[row.run.nodeId] ?? row.run.nodeId} · 尝试 {row.run.attempt}</button>
      <div className="execution-insights__time-track" aria-label={`${row.run.status} ${durationLabel(row.duration)}`}>
        <span className="execution-insights__queue" style={{ left: `${row.queueLeft}%`, width: `${row.queueWidth}%` }} />
        {row.start !== null && row.end !== null && !row.issue && <span className={`execution-insights__bar${row.open ? ' is-open' : ''}`} style={{ left: `${row.left}%`, width: `${row.width}%` }} />}
      </div>
      <span className="execution-waterfall__span">{row.issue ?? durationLabel(row.duration)}{row.open ? '（截至当前）' : ''}</span>
    </div>)}
  </section>
}
