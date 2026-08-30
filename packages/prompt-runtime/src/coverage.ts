import type { PluginId, SemanticId } from '@agent-arena/contracts'
import type { PromptSemanticClaim, PromptSemanticContribution } from './contracts.js'

export function validatePromptSemanticCoverage<Kind extends string>(options: {
  readonly pluginIds: readonly PluginId[]
  readonly kinds: readonly Kind[]
  readonly contributions: readonly PromptSemanticContribution<Kind>[]
  readonly claims: readonly PromptSemanticClaim<Kind>[]
}): void {
  const contributions = new Map(options.contributions.map((entry) => [entry.pluginId, entry]))
  const claims = new Map(options.claims.map((entry) => [entry.pluginId, entry]))
  if (contributions.size !== options.contributions.length) {
    throw new Error('Prompt semantic contributions must use unique plugin IDs')
  }
  if (claims.size !== options.claims.length) {
    throw new Error('Prompt semantic claims must use unique plugin IDs')
  }
  for (const pluginId of options.pluginIds) {
    const contribution = contributions.get(pluginId)
    const claim = claims.get(pluginId)
    if (!contribution) throw new Error(`Missing semantic contribution for ${pluginId}`)
    if (!claim) throw new Error(`Missing Prompt bundle claim for ${pluginId}`)
    for (const kind of options.kinds) {
      assertSameIds(`${pluginId} ${kind}`, contribution.semantics[kind], claim.semantics[kind])
    }
  }
  for (const claim of options.claims) {
    if (!options.pluginIds.includes(claim.pluginId)) {
      throw new Error(`Prompt bundle ${claim.pluginId} is not installed`)
    }
  }
}

export function assertPromptPresentations(
  label: string,
  required: readonly SemanticId[],
  presented: readonly SemanticId[],
): void {
  assertSameIds(label, required, presented)
}

function assertSameIds(
  label: string,
  expected: readonly SemanticId[],
  actual: readonly SemanticId[],
): void {
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  const missing = expected.filter((id) => !actualSet.has(id))
  const extra = actual.filter((id) => !expectedSet.has(id))
  if (missing.length > 0 || extra.length > 0 || actualSet.size !== actual.length) {
    throw new Error(
      `${label} mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`,
    )
  }
}
