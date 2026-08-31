import { describe, expect, it } from 'vitest'
import {
  IconArrowsJoin,
  IconBoxMultiple,
  IconCalculator,
  IconCloudUpload,
  IconDatabase,
  IconFileCertificate,
  IconHierarchy,
  IconMovie,
  IconPackage,
  IconPhotoSpark,
  IconScan,
  IconShieldCheck,
  IconTimeline,
  IconTransfer,
  IconWriting,
} from '@tabler/icons-react'
import type { WorkflowNodePresentation } from '../../../workflowNodePresentation'
import { workflowNodeGlyphComponent } from './WorkflowNodeGlyph'

function presentation(operation: string): WorkflowNodePresentation {
  return {
    variant: 'stage',
    category: null,
    categoryLabel: '工作流',
    operation,
    operationLabel: operation,
    executorRef: '',
    executionModeLabel: '单次',
    triggerKind: null,
    inputPorts: [],
    outputPorts: [],
    summary: '',
    iconUrl: null,
  }
}

describe('workflow node operation icons', () => {
  it.each([
    ['canvas_source', IconDatabase],
    ['delivery_contract', IconFileCertificate],
    ['beat_sheet', IconTimeline],
    ['asset_coverage', IconScan],
    ['asset_fan_out', IconHierarchy],
    ['image_generate', IconPhotoSpark],
    ['fan_out', IconBoxMultiple],
    ['clip_writer', IconWriting],
    ['prompt_package', IconPackage],
    ['estimate', IconCalculator],
    ['production_handoff', IconTransfer],
    ['video_submission', IconCloudUpload],
    ['video_result', IconMovie],
    ['concat', IconArrowsJoin],
    ['delivery_verify', IconShieldCheck],
  ])('maps %s to its own semantic icon', (operation, expectedIcon) => {
    expect(workflowNodeGlyphComponent(presentation(operation))).toBe(expectedIcon)
  })
})
