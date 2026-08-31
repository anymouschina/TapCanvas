import { describe, expect, it } from 'vitest'

import { applyAgentExecutionToolPolicy } from './agents-bridge-tool-policy'
import { inspectAgentsBridgeRemoteToolSurface } from './task.agents-bridge'

const remoteTools = [
  { name: 'tapcanvas_flow_get', description: 'read flow' },
  { name: 'tapcanvas_shot_table_critic', description: 'critic' },
  { name: 'tapcanvas_flow_patch', description: 'mutate flow' },
]

describe('applyAgentExecutionToolPolicy', () => {
  it('keeps the default tool surface when no policy is declared', () => {
    expect(applyAgentExecutionToolPolicy({ policy: undefined, remoteTools })).toEqual({
      remoteTools,
			remoteToolCatalog: [],
      allowedTools: null,
      mode: 'default',
    })
  })

	it('hard-denies provider submission tools from both hot and deferred surfaces', () => {
		const catalog = [
			{ name: 'tapcanvas_video_generate_to_canvas', description: 'submit video' },
			{ name: 'tapcanvas_image_reconcile', description: 'reconcile image' },
		]
		expect(applyAgentExecutionToolPolicy({
			policy: undefined,
			remoteTools: [
				...remoteTools,
				{ name: 'tapcanvas_image_generate_to_canvas', description: 'submit image' },
			],
			remoteCatalogTools: catalog,
			deniedRemoteTools: [
				'tapcanvas_image_generate_to_canvas',
				'tapcanvas_video_generate_to_canvas',
			],
		})).toEqual({
			remoteTools,
			remoteToolCatalog: [
				{ name: 'tapcanvas_image_reconcile', description: 'reconcile image' },
			],
			allowedTools: null,
			mode: 'default',
		})
	})

	it('intersects a caller allowlist with the machine-owned hard denylist', () => {
		expect(applyAgentExecutionToolPolicy({
			policy: {
				mode: 'restricted',
				allowedTools: [
					'tapcanvas_image_generate_to_canvas',
					'tapcanvas_flow_get',
				],
			},
			remoteTools: [
				{ name: 'tapcanvas_image_generate_to_canvas' },
				{ name: 'tapcanvas_flow_get' },
			],
			deniedRemoteTools: ['tapcanvas_image_generate_to_canvas'],
		})).toEqual({
			remoteTools: [{ name: 'tapcanvas_flow_get' }],
			remoteToolCatalog: [],
			allowedTools: ['tapcanvas_flow_get'],
			mode: 'restricted',
		})
	})

  it('restricts the direct surface while leaving authenticated deferred tools dormant', () => {
    expect(applyAgentExecutionToolPolicy({
      policy: {
        mode: 'restricted',
        allowedTools: ['read_file', 'read_file_range', 'tapcanvas_shot_table_critic'],
      },
      remoteTools,
    })).toEqual({
      remoteTools: [{ name: 'tapcanvas_shot_table_critic', description: 'critic' }],
			remoteToolCatalog: [],
      allowedTools: ['read_file', 'read_file_range', 'tapcanvas_shot_table_critic'],
      mode: 'restricted',
    })
  })

	it('admits the complete agents-cli local prompt-example retrieval protocol without remote definitions', () => {
		expect(applyAgentExecutionToolPolicy({
			policy: {
				mode: 'restricted',
				allowedTools: ['Skill', 'prompt_example_search', 'prompt_example_read'],
			},
			remoteTools: [],
		})).toEqual({
			remoteTools: [],
			remoteToolCatalog: [],
			allowedTools: ['Skill', 'prompt_example_search', 'prompt_example_read'],
			mode: 'restricted',
		})
	})

  it('fails explicitly when the caller names a tool absent from the execution surface', () => {
    expect(() => applyAgentExecutionToolPolicy({
      policy: {
        mode: 'restricted',
        allowedTools: ['tapcanvas_missing_tool'],
      },
      remoteTools,
    })).toThrow('当前执行面不存在的工具')
  })

	it('只接受当前一键成片主路由并显式拒绝已退役路由', () => {
		const currentPolicy = {
			mode: 'restricted' as const,
			allowedTools: [
				'record_user_intent',
				'tapcanvas_equipped_workflow_run',
			],
		}

		expect(applyAgentExecutionToolPolicy({
			policy: currentPolicy,
			remoteTools: [{ name: 'tapcanvas_equipped_workflow_run' }],
		})).toMatchObject({
			remoteTools: [{ name: 'tapcanvas_equipped_workflow_run' }],
			allowedTools: ['record_user_intent', 'tapcanvas_equipped_workflow_run'],
		})

		expect(() => applyAgentExecutionToolPolicy({
			policy: {
				mode: 'restricted',
				allowedTools: ['tapcanvas_equipped_workflow_run', 'tapcanvas_video_orchestrate'],
			},
			remoteTools: [{ name: 'tapcanvas_equipped_workflow_run' }],
		})).toThrow('当前执行面不存在的工具')
	})

	it('keeps an explicitly selected hidden reviewer as an opt-in direct tool', () => {
		const unscopedSurface = inspectAgentsBridgeRemoteToolSurface({
      publicAgentsRequest: true,
      canvasProjectId: null,
      canvasFlowId: null,
    })
		expect(unscopedSurface.tools).toEqual([])
		expect(unscopedSurface.catalog).toEqual([])

    expect(applyAgentExecutionToolPolicy({
      policy: {
        mode: 'restricted',
        allowedTools: ['read_file', 'read_file_range', 'tapcanvas_shot_table_critic'],
      },
			remoteTools: unscopedSurface.tools,
			optionalDirectTools: unscopedSurface.explicitCapabilityTools,
    })).toMatchObject({
      mode: 'restricted',
      allowedTools: ['read_file', 'read_file_range', 'tapcanvas_shot_table_critic'],
			remoteTools: [{ name: 'tapcanvas_shot_table_critic' }],
			remoteToolCatalog: [],
    })
  })

	it('keeps the complete authenticated catalog deferred and rejects catalog-external names', () => {
		const direct = [{ name: 'tapcanvas_books_list', description: 'discover books' }]
		const catalog = [{ name: 'tapcanvas_story_facts_commit', description: 'commit facts' }]

		expect(applyAgentExecutionToolPolicy({
			policy: {
				mode: 'restricted',
				allowedTools: ['tapcanvas_story_facts_commit'],
			},
			remoteTools: direct,
			remoteCatalogTools: catalog,
		})).toMatchObject({
			mode: 'restricted',
			remoteTools: [],
			remoteToolCatalog: catalog,
		})

		expect(() => applyAgentExecutionToolPolicy({
			policy: {
				mode: 'restricted',
				allowedTools: ['tapcanvas_not_authorized'],
			},
			remoteTools: direct,
			remoteCatalogTools: catalog,
		})).toThrow('当前执行面不存在的工具')
	})
})
