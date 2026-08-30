import { describe, expect, it } from 'vitest'
import { DeliveryLedger } from '../src/index.js'

describe('DeliveryLedger', () => {
  it('advances only after acknowledgement', () => {
    const ledger = new DeliveryLedger()
    const attempt = ledger.begin('delivery-1', 14, '2026-08-22T00:00:00.000Z')
    expect(attempt.fromSequence).toBe(1)
    expect(ledger.acknowledgedSequence).toBe(0)
    expect(ledger.acknowledge('delivery-1')).toBe(14)
    expect(ledger.activeAttempt).toBeNull()
  })

  it('blocks retries after uncertain delivery', () => {
    const ledger = new DeliveryLedger({ acknowledgedSequence: 9, activeAttempt: null })
    ledger.begin('delivery-2', 12)
    ledger.markUncertain('delivery-2', 'process disconnected')

    expect(() => ledger.begin('delivery-3', 15)).toThrow(/must be resolved/)
    expect(() => ledger.acknowledge('delivery-2')).toThrow(/cannot be acknowledged/)
    expect(ledger.snapshot().acknowledgedSequence).toBe(9)
  })

  it('abandons an uncertain turn while advancing past already delivered context', () => {
    const ledger = new DeliveryLedger({ acknowledgedSequence: 9, activeAttempt: null })
    ledger.begin('delivery-3', 15)
    ledger.markUncertain('delivery-3', 'turn timed out')

    expect(ledger.abandonUncertain('delivery-3')).toBe(15)
    expect(ledger.snapshot()).toEqual({ acknowledgedSequence: 15, activeAttempt: null })
    expect(ledger.begin('delivery-4', 18).fromSequence).toBe(16)
  })

  it('rejects backwards/mismatched transitions and safely clears only in-flight attempts', () => {
    const ledger = new DeliveryLedger({
      acknowledgedSequence: 5,
      activeAttempt: {
        id: 'restored',
        fromSequence: 6,
        toSequence: 8,
        startedAt: '2026-08-28T00:00:00.000Z',
        state: 'in-flight',
      },
    })
    expect(ledger.activeAttempt?.id).toBe('restored')
    expect(() => ledger.begin('blocked', 9)).toThrow(/must be resolved/)
    expect(() => ledger.acknowledge('wrong')).toThrow(/not active/)
    expect(() => ledger.markUncertain('wrong', 'x')).toThrow(/not active/)
    expect(() => ledger.clearUnsent('wrong')).toThrow(/not active/)
    expect(() => ledger.abandonUncertain('wrong')).toThrow(/not active/)
    ledger.clearUnsent('restored')
    expect(ledger.activeAttempt).toBeNull()
    expect(() => ledger.begin('backwards', 4)).toThrow(/backwards/)

    ledger.begin('equal', 5)
    expect(ledger.acknowledge('equal')).toBe(5)
    ledger.begin('uncertain', 6)
    ledger.markUncertain('uncertain', 'uncertain')
    expect(() => ledger.clearUnsent('uncertain')).toThrow(/not safely clearable/)

    const inFlight = new DeliveryLedger()
    inFlight.begin('in-flight', 1)
    expect(() => inFlight.abandonUncertain('in-flight')).toThrow(/not uncertain/)
  })
})
