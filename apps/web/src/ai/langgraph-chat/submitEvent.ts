export const LANGGRAPH_SUBMIT_EVENT = 'tapcanvas:langgraph:submit'

export type LangGraphSubmitEffort = 'low' | 'medium' | 'high'

export type LangGraphChatEventDetail = {
  action: 'submit' | 'prefill'
  input: string
  effort?: LangGraphSubmitEffort
  refs?: { type: 'node'; id: string }[]
}

export function submitToLangGraphChat(input: string, effort: LangGraphSubmitEffort = 'medium') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<LangGraphChatEventDetail>(LANGGRAPH_SUBMIT_EVENT, {
      detail: { action: 'submit', input, effort },
    }),
  )
}

export function prefillLangGraphChat(input: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<LangGraphChatEventDetail>(LANGGRAPH_SUBMIT_EVENT, {
      detail: { action: 'prefill', input, refs: [] },
    }),
  )
}

export function prefillLangGraphChatWithRefs(args: { input?: string; nodeIds: string[] }) {
  if (typeof window === 'undefined') return
  const refs = (args.nodeIds || []).filter(Boolean).map((id) => ({ type: 'node' as const, id }))
  window.dispatchEvent(
    new CustomEvent<LangGraphChatEventDetail>(LANGGRAPH_SUBMIT_EVENT, {
      detail: { action: 'prefill', input: args.input || '', refs },
    }),
  )
}
