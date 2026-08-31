// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createBrowserSpeechPort } from '../src/index.js'

class FakeUtterance extends EventTarget {
  lang = ''
  rate = 0
  pitch = 0
  volume = 0

  public constructor(public readonly text: string) {
    super()
  }
}

describe('createBrowserSpeechPort', () => {
  it('configures utterances and forwards browser callbacks', () => {
    const speak = vi.fn()
    const cancel = vi.fn()
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel },
    })
    const ended = vi.fn()
    const failed = vi.fn()
    const port = createBrowserSpeechPort({ lang: 'zh-CN', rate: 1.2, pitch: 0.8, volume: 0.7 })
    expect(port.supported).toBe(true)
    port.speak('hello', { end: ended, error: failed })
    const utterance = speak.mock.calls[0]![0] as FakeUtterance
    expect(utterance).toMatchObject({
      text: 'hello',
      lang: 'zh-CN',
      rate: 1.2,
      pitch: 0.8,
      volume: 0.7,
    })
    utterance.dispatchEvent(new Event('end'))
    utterance.dispatchEvent(new Event('error'))
    expect(ended).toHaveBeenCalledOnce()
    expect(failed).toHaveBeenCalledOnce()
    port.cancel()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('is safe when browser speech is unavailable and uses default tuning', () => {
    const speak = vi.fn()
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak, cancel: vi.fn() },
    })
    const defaults = createBrowserSpeechPort({ lang: 'en-US' })
    defaults.speak('defaults', { end: vi.fn(), error: vi.fn() })
    expect(speak.mock.calls[0]![0]).toMatchObject({ rate: 1, pitch: 1, volume: 1 })

    vi.stubGlobal('SpeechSynthesisUtterance', undefined)
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined })
    const unavailable = createBrowserSpeechPort({ lang: 'en-US' })
    expect(unavailable.supported).toBe(false)
    expect(() => unavailable.cancel()).not.toThrow()
    expect(() => unavailable.speak('x', { end: vi.fn(), error: vi.fn() })).toThrow(/unavailable/u)

    vi.stubGlobal('window', undefined)
    expect(createBrowserSpeechPort({ lang: 'en-US' }).supported).toBe(false)
  })
})
