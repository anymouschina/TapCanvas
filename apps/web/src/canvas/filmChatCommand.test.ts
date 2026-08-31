import { describe, expect, it } from 'vitest'
import {
  buildCanvasNodeFilmChatText,
	buildChapterFilmExecutionToolPolicy,
  buildChapterFilmSpecDirective,
  buildPlainTextFilmChatText,
  CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT,
  CHAPTER_FILM_CHAT_DISPLAY_TEXT,
  CHAPTER_FILM_CHAT_TEXT,
  TEXT_NODE_FILM_CHAT_DISPLAY_TEXT,
} from './filmChatCommand'

describe('film chat commands', () => {
  it('章级一键成片按显式改编模式执行，但不固定模型或本地创作流程', () => {
    const chapter = CHAPTER_FILM_CHAT_TEXT + buildChapterFilmSpecDirective({
      deliveryScope: 'opening_duration',
      targetDurationSeconds: 90,
      adaptationMode: 'creative',
      notes: '保留克制表演',
    })
    const node = buildCanvasNodeFilmChatText('node-1')
    const plainText = buildPlainTextFilmChatText('node-2', '他收到一封迟到十年的信。')

    for (const text of [chapter, node, plainText]) {
      expect(text).toContain('真实成片 URL')
      expect(text).not.toContain('自主判断改编策略')
      expect(text).not.toContain('Seedance')
      expect(text).not.toContain('S1')
      expect(text).not.toContain('S8')
      expect(text).not.toContain('逐镜')
    }
    expect(chapter).toContain('创意改编')
    expect(chapter).toContain('executionScope=media_delivery')
    expect(chapter).toContain('executionVariant=full_video')
		expect(chapter).toContain('不得用账号偏好')
    expect(chapter).not.toContain('"aspect"')
    expect(chapter).not.toContain('"resolution"')
    expect(chapter).toContain('"targetDurationSeconds":90')
    expect(node).toContain('"nodeId":"node-1"')
    expect(node).toContain('逐字台词')
    expect(node).toContain('画面描述只作为视觉指令')
    expect(plainText).toContain('他收到一封迟到十年的信。')
  })

  it('机器执行合同与用户可见动作摘要严格分离', () => {
    expect(CHAPTER_FILM_CHAT_DISPLAY_TEXT).toBe('生成当前章节整片')
    expect(TEXT_NODE_FILM_CHAT_DISPLAY_TEXT).toBe('将当前文本节点制作成视频')
    expect(CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT).toBe('生成当前节点整片')
    for (const displayText of [
      CHAPTER_FILM_CHAT_DISPLAY_TEXT,
      TEXT_NODE_FILM_CHAT_DISPLAY_TEXT,
      CANVAS_NODE_FILM_CHAT_DISPLAY_TEXT,
    ]) {
      expect(displayText.length).toBeLessThan(30)
      expect(displayText).not.toContain('generationContract')
      expect(displayText).not.toContain('deliveryScope')
    }
  })

	it('章级一键成片只允许已确认的 Workflow IR 主路由', () => {
		const policy = buildChapterFilmExecutionToolPolicy()
		expect(policy.mode).toBe('restricted')
		expect(policy.allowedTools).toEqual([
			'record_user_intent',
			'Skill',
			'tapcanvas_book_chapter_get',
			'tapcanvas_image_refs_get',
			'tapcanvas_material_assets_list',
			'tapcanvas_equipped_workflow_run',
		])
		expect(policy.allowedTools).not.toContain('tapcanvas_analyze_video')
		expect(policy.allowedTools).not.toContain('tapcanvas_director_set_character_motion')
		expect(policy.allowedTools).not.toContain('tapcanvas_project_context_get')
		expect(policy.allowedTools).not.toContain('tapcanvas_execution_get')
		expect(policy.allowedTools).not.toContain('tapcanvas_execution_node_runs_get')
		expect(policy.allowedTools).not.toContain('tapcanvas_execution_events_list')
	})
})
