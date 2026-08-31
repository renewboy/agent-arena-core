import type { PlaybackPort } from '@agent-arena/web-runtime'

export interface BrowserSpeechOptions {
  readonly lang: string
  readonly rate?: number
  readonly pitch?: number
  readonly volume?: number
}

function supportsBrowserSpeech(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

export function createBrowserSpeechPort(options: BrowserSpeechOptions): PlaybackPort {
  return {
    get supported() {
      return supportsBrowserSpeech()
    },
    speak: (text, callbacks) => {
      if (!supportsBrowserSpeech()) throw new Error('SpeechSynthesis is unavailable')
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = options.lang
      utterance.rate = options.rate ?? 1
      utterance.pitch = options.pitch ?? 1
      utterance.volume = options.volume ?? 1
      utterance.addEventListener('end', () => callbacks.end())
      utterance.addEventListener('error', (event) => callbacks.error(event))
      window.speechSynthesis.speak(utterance)
    },
    cancel: () => {
      if (supportsBrowserSpeech()) window.speechSynthesis.cancel()
    },
  }
}
