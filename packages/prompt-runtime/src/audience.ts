import type { PromptAudienceClass } from './contracts.js'

export function canImportPromptAudience(
  importer: PromptAudienceClass,
  imported: PromptAudienceClass,
): boolean {
  if (imported === 'public' || importer === 'host') return true
  return importer === imported
}
