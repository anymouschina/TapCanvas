import { create } from 'zustand'

export type WorkflowNodeInspectorTab = 'configuration' | 'input' | 'output' | 'history' | 'run'

type WorkflowNodeInspectorState = Readonly<{
  nodeId: string | null
  tab: WorkflowNodeInspectorTab
  openNode: (nodeId: string) => void
  close: () => void
  setTab: (tab: WorkflowNodeInspectorTab) => void
}>

export const useWorkflowNodeInspectorStore = create<WorkflowNodeInspectorState>((set) => ({
  nodeId: null,
  tab: 'configuration',
  openNode: (nodeId) => set({ nodeId, tab: 'configuration' }),
  close: () => set({ nodeId: null, tab: 'configuration' }),
  setTab: (tab) => set({ tab }),
}))
