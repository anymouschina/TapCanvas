import { create } from 'zustand'

function getInitialAssetPersistence(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const v = window.localStorage.getItem('tapcanvas_asset_persist')
    if (v === '0') return false
  } catch {
    // ignore
  }
  return true
}

export type CharacterCreatorPayload = {
  source?: string
  name?: string
  summary?: string
  tags?: string[]
  videoVendor?: string | null
  soraTokenId?: string | null
  clipRange?: { start: number; end: number }
  videoUrl?: string | null
  videoTitle?: string | null
  videoTokenId?: string | null
}

export type VideoTrimPayload = {
  videoUrl: string
  originalDuration: number
  thumbnails: string[]
  defaultRange?: { start: number; end: number }
  loading?: boolean
  progressPct?: number | null
  onConfirm: (range: { start: number; end: number }) => void
  onClose?: () => void
}

type UIState = {
  subflowNodeId: string | null
  openSubflow: (nodeId: string) => void
  closeSubflow: () => void
  libraryFlowId: string | null
  openLibraryFlow: (flowId: string) => void
  closeLibraryFlow: () => void
  compact: boolean
  toggleCompact: () => void
  addPanelOpen: boolean
  setAddPanelOpen: (v: boolean) => void
  templatePanelOpen: boolean
  setTemplatePanelOpen: (v: boolean) => void
  activePanel: 'add' | 'template' | 'assets' | 'tapshow' | 'account' | 'project' | 'models' | 'history' | 'ai-chat' | null
  setActivePanel: (p: 'add' | 'template' | 'assets' | 'tapshow' | 'account' | 'project' | 'models' | 'history' | 'ai-chat' | null) => void
  panelAnchorY: number | null
  setPanelAnchorY: (y: number | null) => void
  paramNodeId: string | null
  openParamFor: (id: string) => void
  closeParam: () => void
  preview: { url: string; kind: 'image'|'video'|'audio'; name?: string } | null
  openPreview: (m: { url: string; kind: 'image'|'video'|'audio'; name?: string }) => void
  closePreview: () => void
  focusStack: string[]
  enterGroupFocus: (id: string) => void
  exitGroupFocus: () => void
  exitAllFocus: () => void
  edgeRoute: 'smooth' | 'orth'
  toggleEdgeRoute: () => void
  currentFlow: { id?: string|null; name: string; source: 'local'|'server' }
  setCurrentFlow: (patch: Partial<{ id?: string|null; name: string; source: 'local'|'server' }>) => void
  isDirty: boolean
  setDirty: (v: boolean) => void
  currentProject: { id?: string|null; name: string } | null
  setCurrentProject: (p: { id?: string|null; name: string } | null) => void
  promptSuggestMode: 'off' | 'history' | 'semantic'
  setPromptSuggestMode: (m: 'off' | 'history' | 'semantic') => void
  soraVideoBaseUrl: string | null
  setSoraVideoBaseUrl: (url: string | null) => void
  videoTrimModal: { open: boolean; payload?: VideoTrimPayload | null }
  openVideoTrimModal: (payload: VideoTrimPayload) => void
  updateVideoTrimModal: (patch: Partial<VideoTrimPayload>) => void
  closeVideoTrimModal: () => void
  characterCreatorModal: { open: boolean; payload?: CharacterCreatorPayload | null }
  openCharacterCreatorModal: (payload: CharacterCreatorPayload) => void
  closeCharacterCreatorModal: () => void
  characterCreatorRequest: { timestamp: number; payload?: CharacterCreatorPayload } | null
  requestCharacterCreator: (payload?: CharacterCreatorPayload | null) => void
  clearCharacterCreatorRequest: () => void
  // AI Chat
  aiChatMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>
  addAiMessage: (message: { role: 'user' | 'assistant'; content: string }) => void
  clearAiMessages: () => void
  selectedAiModel: string
  setSelectedAiModel: (model: string) => void
  assetPersistenceEnabled: boolean
  setAssetPersistenceEnabled: (v: boolean) => void
}

export const useUIStore = create<UIState>((set) => ({
  subflowNodeId: null,
  openSubflow: (nodeId) => set({ subflowNodeId: nodeId }),
  closeSubflow: () => set({ subflowNodeId: null }),
  libraryFlowId: null,
  openLibraryFlow: (flowId) => set({ libraryFlowId: flowId }),
  closeLibraryFlow: () => set({ libraryFlowId: null }),
  compact: false,
  toggleCompact: () => set((s) => ({ compact: !s.compact })),
  addPanelOpen: false,
  setAddPanelOpen: (v) => set({ addPanelOpen: v }),
  templatePanelOpen: false,
  setTemplatePanelOpen: (v) => set({ templatePanelOpen: v }),
  activePanel: null,
  setActivePanel: (p) => set({ activePanel: p }),
  panelAnchorY: null,
  setPanelAnchorY: (y) => set({ panelAnchorY: y }),
  paramNodeId: null,
  openParamFor: (id) => set({ paramNodeId: id }),
  closeParam: () => set({ paramNodeId: null }),
  preview: null,
  openPreview: (m) => set({ preview: m }),
  closePreview: () => set({ preview: null }),
  focusStack: [],
  enterGroupFocus: (id) => set((s) => ({ focusStack: [...s.focusStack, id] })),
  exitGroupFocus: () => set((s) => ({ focusStack: s.focusStack.slice(0, -1) })),
  exitAllFocus: () => set({ focusStack: [] }),
  edgeRoute: 'smooth',
  toggleEdgeRoute: () => set((s) => ({ edgeRoute: s.edgeRoute === 'smooth' ? 'orth' : 'smooth' })),
  currentFlow: { id: null, name: '未命名', source: 'local' },
  setCurrentFlow: (patch) => set((s) => ({ currentFlow: { ...s.currentFlow, ...(patch||{}) } })),
  isDirty: false,
  setDirty: (v) => set({ isDirty: v }),
  currentProject: null,
  setCurrentProject: (p) => set({ currentProject: p }),
  promptSuggestMode: 'off',
  setPromptSuggestMode: (m) => set({ promptSuggestMode: m }),
  soraVideoBaseUrl: null,
  setSoraVideoBaseUrl: (url) => set({ soraVideoBaseUrl: url }),
  videoTrimModal: { open: false, payload: null },
  openVideoTrimModal: (payload) => set({ videoTrimModal: { open: true, payload } }),
  updateVideoTrimModal: (patch) =>
    set((s) => ({
      videoTrimModal: s.videoTrimModal.open
        ? { open: true, payload: { ...(s.videoTrimModal.payload || {}), ...patch } }
        : s.videoTrimModal,
    })),
  closeVideoTrimModal: () => set({ videoTrimModal: { open: false, payload: null } }),
  characterCreatorModal: { open: false, payload: null },
  openCharacterCreatorModal: (payload) => set({ characterCreatorModal: { open: true, payload } }),
  closeCharacterCreatorModal: () => set({ characterCreatorModal: { open: false, payload: null } }),
  characterCreatorRequest: null,
  requestCharacterCreator: (payload) =>
    set({
      characterCreatorRequest: payload
        ? { timestamp: Date.now(), payload }
        : { timestamp: Date.now() },
    }),
  clearCharacterCreatorRequest: () => set({ characterCreatorRequest: null }),
  // AI Chat
  aiChatMessages: [],
  addAiMessage: (message) => set((s) => ({
    aiChatMessages: [...s.aiChatMessages, { ...message, timestamp: Date.now() }]
  })),
  clearAiMessages: () => set({ aiChatMessages: [] }),
  selectedAiModel: 'gemini-2.0-flash-exp',
  setSelectedAiModel: (model) => set({ selectedAiModel: model }),
  assetPersistenceEnabled: getInitialAssetPersistence(),
  setAssetPersistenceEnabled: (v) => {
    set({ assetPersistenceEnabled: v })
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('tapcanvas_asset_persist', v ? '1' : '0')
      } catch {
        // ignore
      }
    }
  },
}))
