import React from 'react'
import './WorkflowNodePorts.css'

type Props = Readonly<{ inputPorts: readonly string[]; outputPorts: readonly string[] }>

function Port({ label, values }: { label: string; values: readonly string[] }): React.JSX.Element {
  return <span className="workflow-node-port" title={values.join(', ')}><b className="workflow-node-ports__b">{label}</b><span className="workflow-node-ports__span">{values.join(' · ') || '无'}</span></span>
}

export function WorkflowNodePorts({ inputPorts, outputPorts }: Props): React.JSX.Element {
  return <div className="workflow-node-ports"><Port label="输入" values={inputPorts} /><span className="workflow-node-ports__arrow" aria-hidden="true">→</span><Port label="输出" values={outputPorts} /></div>
}
