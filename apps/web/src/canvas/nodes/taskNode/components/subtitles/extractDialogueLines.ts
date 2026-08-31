export type DialogueLine = { speaker: string; text: string }

// 与服务端 apps/hono-api/src/modules/task/video-orchestrator.dialog-audio.ts 的
// DIALOGUE_LINE_RE / isDegenerateDialogue 保持同步（前端不 import 后端模块，复制一份）。
// @角色（情绪）：「台词」 / [旁白]（悬疑）：「台词」 / 台词：@角色：「台词」——情绪括注可选。
const DIALOGUE_LINE_RE =
  /(?:@|\[)?([一-龥A-Za-z0-9]{1,8})(?:\])?\s*(?:（[^）]*）|\([^)]*\))?\s*[:：]\s*「([^」]+)」/g

/** 纯标点/省略号等退化"台词"（如「……」表沉默）不算对白。 */
export function isDegenerateDialogue(text: string): boolean {
  const real = String(text || '').replace(
    /[\s。，、！？…·—\-.,!?：:；;（）()「」『』""''"']/g,
    '',
  )
  return real.length < 2
}

/** 从 clip prompt 逐字抽出（说话人, 台词）序列（保序，滤退化句）。 */
export function extractDialogueLines(clipPrompt: string): DialogueLine[] {
  const out: DialogueLine[] = []
  const src = String(clipPrompt || '')
  let m: RegExpExecArray | null
  DIALOGUE_LINE_RE.lastIndex = 0
  while ((m = DIALOGUE_LINE_RE.exec(src)) !== null) {
    const speaker = m[1].trim()
    const text = m[2].trim()
    if (!speaker || !text || isDegenerateDialogue(text)) continue
    out.push({ speaker, text })
  }
  return out
}
