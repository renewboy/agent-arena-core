import {
  promptEnvironment,
  validatePromptBundleGraph,
  type LoadedPromptBundle,
  type PromptBundleAdapter,
} from '@agent-arena/prompt-runtime'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const AudienceSchema = z.enum(['public', 'participant', 'group', 'host'])
const ReferenceSchema = z.object({ reference: z.string(), audience: AudienceSchema }).strict()
const ManifestSchema = z
  .object({
    id: z.string(),
    imports: z.array(z.string()).default([]),
    shared: z.array(ReferenceSchema).default([]),
    references: z.array(ReferenceSchema).default([]),
  })
  .strict()
type Manifest = z.infer<typeof ManifestSchema>

const adapter: PromptBundleAdapter<Manifest> = {
  parseManifest: (input) => ManifestSchema.parse(input),
  bundleId: (manifest) => manifest.id,
  imports: (manifest) => manifest.imports,
  sharedTemplates: (manifest) => manifest.shared,
  templateReferences: (manifest) => [...manifest.shared, ...manifest.references],
  normalizeAudience: (audience) => audience,
}

describe('conformance game Prompt composition', () => {
  it('renders Hidden Team public clues and group-private secrets through separate templates', () => {
    const bundles = graph(
      {
        id: 'hidden',
        imports: ['core'],
        references: [{ reference: 'turn.njk', audience: 'group' }],
      },
      {
        'turn.njk':
          '{% include "core/public.njk" %} group={{ groupId }} secret={{ secret }} clue={{ clue }}',
      },
    )
    expect(() => validatePromptBundleGraph(bundles, adapter)).not.toThrow()
    expect(
      promptEnvironment(bundles)
        .render('hidden/turn.njk', {
          groupId: 'group-red',
          secret: 'ember',
          clue: 'warm light',
        })
        .trim(),
    ).toBe('public group=group-red secret=ember clue=warm light')
  })

  it('renders Reaction Card participant-only hand facts without putting them in public assets', () => {
    const bundles = graph(
      {
        id: 'reaction',
        imports: ['core'],
        references: [{ reference: 'turn.njk', audience: 'participant' }],
      },
      {
        'turn.njk':
          '{% include "core/public.njk" %} health={{ health }} hand={{ hand | join(",") }}',
      },
    )
    expect(() => validatePromptBundleGraph(bundles, adapter)).not.toThrow()
    expect(
      promptEnvironment(bundles)
        .render('reaction/turn.njk', { health: 2, hand: ['strike', 'focus'] })
        .trim(),
    ).toBe('public health=2 hand=strike,focus')
  })
})

function graph(
  gameManifest: Omit<Manifest, 'shared'> & { readonly shared?: Manifest['shared'] },
  templates: Record<string, string>,
): LoadedPromptBundle<Manifest>[] {
  return [
    {
      id: 'core',
      root: '/virtual/core',
      manifest: ManifestSchema.parse({
        id: 'core',
        shared: [{ reference: 'public.njk', audience: 'public' }],
      }),
      templates: new Map([['core/public.njk', 'public']]),
    },
    {
      id: gameManifest.id,
      root: `/virtual/${gameManifest.id}`,
      manifest: ManifestSchema.parse(gameManifest),
      templates: new Map(
        Object.entries(templates).map(([name, source]) => [`${gameManifest.id}/${name}`, source]),
      ),
    },
  ]
}
