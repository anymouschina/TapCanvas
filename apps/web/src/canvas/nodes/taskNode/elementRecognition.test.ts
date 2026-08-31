import { describe, expect, it } from 'vitest'
import { findRecognizedObjectAtPoint, type RecognizedObject } from './elementRecognition'

describe('findRecognizedObjectAtPoint', () => {
  const objects: RecognizedObject[] = [
    { label: 'person', score: 0.9, bounds: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } },
    { label: 'dress', score: 0.9, bounds: { x: 0.25, y: 0.35, width: 0.3, height: 0.4 } },
  ]

  it('returns the smallest equally confident object containing the click', () => {
    expect(findRecognizedObjectAtPoint(objects, { x: 0.4, y: 0.5 })?.label).toBe('dress')
  })

  it('returns null when no detected object contains the click', () => {
    expect(findRecognizedObjectAtPoint(objects, { x: 0.95, y: 0.95 })).toBeNull()
  })
})
