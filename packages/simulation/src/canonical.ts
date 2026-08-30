import { createHash } from 'node:crypto'
import { SimulationReviewedExpectedSchema } from './contracts.js'
import type {
  SimulationExpected,
  SimulationFault,
  SimulationReviewedExpected,
} from './contracts.js'

export function simulationFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function reviewedSimulationExpected(actual: SimulationExpected): SimulationReviewedExpected {
  return SimulationReviewedExpectedSchema.parse({
    eventCount: actual.events.length,
    eventDigest: simulationFingerprint(actual.events),
    eventTypes: actual.events.map((event) => event.eventType),
    checkpoint: actual.checkpoint,
  })
}

export function simulationSeed(simulationId: string, variant: string): string {
  return simulationFingerprint({ simulationId, variant }).slice(0, 16)
}

export function classifySimulationFault(
  status: 'failed' | 'uncertain' | 'cancelled',
  error: string | null,
): SimulationFault {
  if (status === 'uncertain') return 'uncertain-delivery'
  if (status === 'cancelled') return 'cancelled'
  const normalized = error?.toLowerCase() ?? ''
  if (normalized.includes('timed out') || normalized.includes('timeout')) return 'timeout'
  if (
    normalized.includes('process') ||
    normalized.includes('disposed') ||
    normalized.includes('exited')
  ) {
    return 'process-exit'
  }
  if (normalized.includes('invalid') || normalized.includes('unexpected')) return 'invalid-action'
  return 'other'
}

export function scanSimulationSecrets(value: unknown): string[] {
  const text = JSON.stringify(value)
  const warnings: string[] = []
  for (const [code, pattern] of [
    ['authorization-header', /bearer\s+[a-z0-9._~+/-]{12,}/i],
    ['api-key', /(?:sk|sk-proj)-[a-z0-9_-]{12,}/i],
    ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['absolute-user-path', /\/(?:Users|home)\/[^/"\\]+\//],
  ] as const) {
    if (pattern.test(text)) warnings.push(code)
  }
  return warnings
}

export function normalizeSimulationValue(
  value: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === 'string') {
    let normalized = value
    for (const [source, target] of replacements) {
      if (source) normalized = normalized.split(source).join(target)
    }
    return normalized
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSimulationValue(entry, replacements))
  }
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeSimulationValue(child, replacements),
    ]),
  )
}

export function firstSimulationDifference(
  expected: unknown,
  actual: unknown,
  path = 'result',
): string | null {
  if (Object.is(expected, actual)) return null
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      return `${path}.length expected ${expected.length}, received ${actual.length}`
    }
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstSimulationDifference(
        expected[index],
        actual[index],
        `${path}[${index}]`,
      )
      if (difference) return difference
    }
    return null
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort()
    for (const key of keys) {
      const difference = firstSimulationDifference(expected[key], actual[key], `${path}.${key}`)
      if (difference) return difference
    }
    return null
  }
  return `${path} expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
