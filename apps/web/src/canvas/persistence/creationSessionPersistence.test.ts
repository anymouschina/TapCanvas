import { describe, expect, it } from 'vitest'

import { hasCreationSessionProgressChanged } from './creationSessionPersistence'

describe('hasCreationSessionProgressChanged', () => {
  it('does not schedule another save when the acknowledged progress is unchanged', () => {
    const progress = { stage: 'result_persistence', completed: 3 }

    expect(hasCreationSessionProgressChanged(JSON.stringify(progress), progress)).toBe(false)
  })

  it('marks only a factual progress change for persistence', () => {
    const acknowledged = { stage: 'constraint_definition', completed: 1 }
    const current = { stage: 'result_persistence', completed: 3 }

    expect(hasCreationSessionProgressChanged(JSON.stringify(current), acknowledged)).toBe(true)
  })

  it('treats missing acknowledged progress as null', () => {
    expect(hasCreationSessionProgressChanged('null', undefined)).toBe(false)
  })
})
