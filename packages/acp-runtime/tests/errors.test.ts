import { describe, expect, it } from 'vitest'
import { AcpDeliveryUncertainError, AcpLifecycleError } from '../src/index.js'

describe('ACP errors', () => {
  it('preserves lifecycle diagnostics and delivery reusability', () => {
    const cause = new Error('cause')
    expect(new AcpLifecycleError('failed')).toMatchObject({
      name: 'AcpLifecycleError',
      stderrTail: '',
    })
    expect(new AcpLifecycleError('failed', 'stderr', { cause })).toMatchObject({
      stderrTail: 'stderr',
      cause,
    })
    expect(new AcpDeliveryUncertainError('uncertain').sessionReusable).toBe(false)
    expect(
      new AcpDeliveryUncertainError('uncertain', { sessionReusable: true }).sessionReusable,
    ).toBe(true)
  })
})
