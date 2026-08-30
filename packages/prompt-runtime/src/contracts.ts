import { z } from 'zod'
import type { PluginId, SemanticId } from '@agent-arena/contracts'

export const PromptAudienceClassSchema = z.enum(['public', 'participant', 'group', 'host'])
export type PromptAudienceClass = z.infer<typeof PromptAudienceClassSchema>

export interface PromptTemplateReference<Audience extends string = PromptAudienceClass> {
  readonly reference: string
  readonly audience: Audience
}

export interface PromptSharedTemplate<
  Audience extends string = PromptAudienceClass,
> extends PromptTemplateReference<Audience> {}

export interface PromptBundleAdapter<
  Manifest,
  BundleId extends string = string,
  Audience extends string = PromptAudienceClass,
> {
  parseManifest(input: unknown): Manifest
  bundleId(manifest: Manifest): BundleId
  imports(manifest: Manifest): readonly BundleId[]
  templateReferences(manifest: Manifest): readonly PromptTemplateReference<Audience>[]
  sharedTemplates(manifest: Manifest): readonly PromptSharedTemplate<Audience>[]
  normalizeAudience(audience: Audience): PromptAudienceClass
  isImplicitImport?(owner: BundleId, imported: BundleId): boolean
}

export interface LoadedPromptBundle<Manifest, BundleId extends string = string> {
  readonly id: BundleId
  readonly root: string
  readonly manifest: Manifest
  readonly templates: ReadonlyMap<string, string>
}

export interface PromptSemanticContribution<Kind extends string> {
  readonly pluginId: PluginId
  readonly semantics: Readonly<Record<Kind, readonly SemanticId[]>>
}

export interface PromptSemanticClaim<Kind extends string> {
  readonly pluginId: PluginId
  readonly semantics: Readonly<Record<Kind, readonly SemanticId[]>>
}

export type PromptMatchValue = string | number | boolean | null | { readonly exists: boolean }

export interface PromptPresentation<Event, Audience extends string = PromptAudienceClass> {
  readonly owner: string
  readonly eventType: string
  readonly where: Readonly<Record<string, PromptMatchValue>>
  readonly audience: Audience
  readonly event?: Event
}
