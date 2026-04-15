export type StoryboardEditorAspect = '1:1' | '4:3' | '16:9' | '9:16'

export type StoryboardEditorGrid = '2x2' | '3x2' | '3x3' | '5x5'

export type StoryboardEditorCell = {
  id: string
  imageUrl: string | null
  aspect?: StoryboardEditorAspect
  label?: string
  prompt?: string
  sourceKind?: string
  sourceNodeId?: string
  sourceIndex?: number
  shotNo?: number
}

export const normalizeStoryboardEditorSelectedIndex = (
  value: unknown,
  cellCount: number,
): number => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return 0
  if (cellCount <= 0) return 0
  return Math.min(Math.max(0, Math.trunc(numeric)), cellCount - 1)
}

export const STORYBOARD_EDITOR_ASPECT_OPTIONS: Array<{ value: StoryboardEditorAspect; label: string }> = [
  { value: '1:1', label: '比例 1:1' },
  { value: '4:3', label: '比例 4:3' },
  { value: '16:9', label: '比例 16:9' },
  { value: '9:16', label: '比例 9:16' },
]

export const STORYBOARD_EDITOR_GRID_OPTIONS: Array<{
  value: StoryboardEditorGrid
  label: string
  columns: number
  rows: number
}> = [
  { value: '2x2', label: '网格 2x2', columns: 2, rows: 2 },
  { value: '3x2', label: '网格 3x2', columns: 3, rows: 2 },
  { value: '3x3', label: '网格 3x3', columns: 3, rows: 3 },
  { value: '5x5', label: '网格 5x5', columns: 5, rows: 5 },
]

const DEFAULT_GRID: StoryboardEditorGrid = '3x3'

const DEFAULT_ASPECT: StoryboardEditorAspect = '4:3'

const createCellId = (index: number) => `storyboard-cell-${index + 1}`

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const normalizeShotNo = (value: unknown): number | null => {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(1, Math.trunc(numeric))
}

const normalizeCell = (value: unknown, index: number): StoryboardEditorCell => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const imageUrl = normalizeText(record.imageUrl) ?? null
  const aspect = normalizeStoryboardEditorAspect(record.aspect)
  const sourceIndexRaw = Number(record.sourceIndex)
  const shotNo = normalizeShotNo(record.shotNo)

  return {
    id: normalizeText(record.id) ?? createCellId(index),
    imageUrl,
    ...(normalizeText(record.aspect) ? { aspect } : null),
    ...(normalizeText(record.label) ? { label: normalizeText(record.label) } : null),
    ...(normalizeText(record.prompt) ? { prompt: normalizeText(record.prompt) } : null),
    ...(normalizeText(record.sourceKind) ? { sourceKind: normalizeText(record.sourceKind) } : null),
    ...(normalizeText(record.sourceNodeId) ? { sourceNodeId: normalizeText(record.sourceNodeId) } : null),
    ...(Number.isFinite(sourceIndexRaw) ? { sourceIndex: Math.max(0, Math.trunc(sourceIndexRaw)) } : null),
    ...(shotNo !== null ? { shotNo } : null),
  }
}

export const getStoryboardEditorGridConfig = (grid: StoryboardEditorGrid) =>
  STORYBOARD_EDITOR_GRID_OPTIONS.find((option) => option.value === grid) ?? STORYBOARD_EDITOR_GRID_OPTIONS[2]

export const normalizeStoryboardEditorGrid = (value: unknown): StoryboardEditorGrid => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return STORYBOARD_EDITOR_GRID_OPTIONS.some((option) => option.value === raw as StoryboardEditorGrid)
    ? raw as StoryboardEditorGrid
    : DEFAULT_GRID
}

export const normalizeStoryboardEditorAspect = (value: unknown): StoryboardEditorAspect => {
  const raw = typeof value === 'string' ? value.trim() : ''
  return STORYBOARD_EDITOR_ASPECT_OPTIONS.some((option) => option.value === raw as StoryboardEditorAspect)
    ? raw as StoryboardEditorAspect
    : DEFAULT_ASPECT
}

export const getStoryboardEditorCellCount = (grid: StoryboardEditorGrid): number => {
  const config = getStoryboardEditorGridConfig(grid)
  return config.columns * config.rows
}

export const resolveStoryboardEditorCellAspect = (
  cell: Pick<StoryboardEditorCell, 'aspect'> | null | undefined,
  fallbackAspect: StoryboardEditorAspect,
): StoryboardEditorAspect => {
  const raw = typeof cell?.aspect === 'string' ? cell.aspect.trim() : ''
  return raw ? normalizeStoryboardEditorAspect(raw) : fallbackAspect
}

export const normalizeStoryboardEditorCells = (
  rawCells: unknown,
  grid: StoryboardEditorGrid,
): StoryboardEditorCell[] => {
  const count = getStoryboardEditorCellCount(grid)
  const source = Array.isArray(rawCells) ? rawCells : []
  return Array.from({ length: count }, (_, index) => normalizeCell(source[index], index))
}

export type StoryboardDerivedPromptData = {
  storyboardShotPrompts: string[]
  storyboardScript: string
  prompt: string
}

export const deriveStoryboardPromptDataFromCells = (
  cells: StoryboardEditorCell[],
): StoryboardDerivedPromptData | null => {
  const promptCells = cells
    .map((cell, index) => {
      const prompt = normalizeText(cell.prompt)
      if (!prompt) return null
      return {
        prompt,
        shotNo: normalizeShotNo(cell.shotNo) ?? index + 1,
      }
    })
    .filter((cell): cell is { prompt: string; shotNo: number } => cell !== null)

  if (promptCells.length === 0) return null

  const storyboardShotPrompts = promptCells.map((cell) => cell.prompt)
  const storyboardScript = promptCells
    .map((cell) => `镜头 ${cell.shotNo}：${cell.prompt}`)
    .join('\n')

  return {
    storyboardShotPrompts,
    storyboardScript,
    prompt: storyboardScript,
  }
}

export const normalizeStoryboardNodeData = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const patch = buildStoryboardEditorPatch({
    cells: input.storyboardEditorCells,
    grid: input.storyboardEditorGrid,
    aspect: input.storyboardEditorAspect,
    editMode: input.storyboardEditorEditMode,
    collapsed: input.storyboardEditorCollapsed,
  })
  const storyboardEditorSelectedIndex = normalizeStoryboardEditorSelectedIndex(
    input.storyboardEditorSelectedIndex,
    patch.storyboardEditorCells.length,
  )
  const derivedPromptData = deriveStoryboardPromptDataFromCells(patch.storyboardEditorCells)

  return {
    ...input,
    ...patch,
    storyboardEditorSelectedIndex,
    ...(derivedPromptData ? derivedPromptData : null),
    kind: 'storyboard',
  }
}

export const buildStoryboardEditorPatch = (input: {
  cells?: unknown
  grid?: unknown
  aspect?: unknown
  editMode?: unknown
  collapsed?: unknown
}): {
  storyboardEditorCells: StoryboardEditorCell[]
  storyboardEditorGrid: StoryboardEditorGrid
  storyboardEditorAspect: StoryboardEditorAspect
  storyboardEditorEditMode: boolean
  storyboardEditorCollapsed: boolean
} => {
  const grid = normalizeStoryboardEditorGrid(input.grid)
  const storyboardEditorCells = normalizeStoryboardEditorCells(input.cells, grid)
  return {
    storyboardEditorCells,
    storyboardEditorGrid: grid,
    storyboardEditorAspect: normalizeStoryboardEditorAspect(input.aspect),
    storyboardEditorEditMode: Boolean(input.editMode),
    storyboardEditorCollapsed: Boolean(input.collapsed),
  }
}

export const buildDefaultStoryboardEditorData = () =>
  ({
    ...buildStoryboardEditorPatch({
      cells: Array.from({ length: getStoryboardEditorCellCount(DEFAULT_GRID) }, (_, index) => ({ id: createCellId(index), imageUrl: null })),
      grid: DEFAULT_GRID,
      aspect: DEFAULT_ASPECT,
      editMode: false,
      collapsed: false,
    }),
    storyboardEditorSelectedIndex: 0,
  })
