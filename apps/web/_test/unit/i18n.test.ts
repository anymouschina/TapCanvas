import { beforeEach, describe, expect, it } from 'vitest'
import { $, $t, getCurrentLanguage, setLanguage } from '../../src/canvas/i18n'

describe('i18n helpers', () => {
  beforeEach(() => {
    setLanguage('zh')
    localStorage.removeItem('tapcanvas-language')
  })

  it('returns source text in zh mode', () => {
    expect($('保存')).toBe('保存')
  })

  it('translates known text in en mode', () => {
    setLanguage('en')
    expect($('保存')).toBe('Save')
  })

  it('interpolates params after translation', () => {
    setLanguage('en')
    expect($t('项目「{{name}}」已保存', { name: 'Demo' })).toBe('Project "Demo" saved')
    // Unknown source falls back to original text and still interpolates.
    expect($t('你好，{{name}}', { name: 'TapCanvas' })).toBe('你好，TapCanvas')
  })

  it('persists selected language to localStorage', () => {
    setLanguage('en')
    expect(getCurrentLanguage()).toBe('en')
    expect(localStorage.getItem('tapcanvas-language')).toBe('en')
  })
})
