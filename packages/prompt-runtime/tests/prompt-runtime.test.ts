import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { PluginIdSchema, SemanticIdSchema } from '@agent-arena/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assertPromptPresentations,
  assertPromptRootHasNoLocale,
  canImportPromptAudience,
  loadPromptBundle,
  precompilePromptTemplates,
  promptEnvironment,
  resolvePromptRoot,
  selectPromptPresentation,
  validatePromptBundleGraph,
  validatePromptPresentationMatchers,
  validatePromptSemanticCoverage,
  type LoadedPromptBundle,
  type PromptBundleAdapter,
  type PromptPresentation,
} from '../src/index.js'

const AudienceSchema = z.enum(['public', 'participant', 'group', 'host'])
const ReferenceSchema = z.object({ reference: z.string(), audience: AudienceSchema }).strict()
const ManifestSchema = z
  .object({
    id: z.string().min(1),
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
  templateReferences: (manifest) => [...manifest.shared, ...manifest.references],
  sharedTemplates: (manifest) => manifest.shared,
  normalizeAudience: (audience) => audience,
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Prompt bundle files and graph', () => {
  it('loads, validates, precompiles, and renders a frozen bundle graph', async () => {
    const root = await fixture()
    expect(resolvePromptRoot(root)).toBe(await realpath(root))
    expect(() => assertPromptRootHasNoLocale(root)).not.toThrow()
    const bundles = loadGraph(root)
    expect(() => validatePromptBundleGraph(bundles, adapter)).not.toThrow()
    const environment = promptEnvironment(bundles)
    precompilePromptTemplates(environment, bundles)
    expect(environment.render('game/turn.njk', { value: 'ready' }).trim()).toBe('public ready')
    expect(() => environment.getTemplate('missing/template.njk', true)).toThrow(/Unknown Prompt/)
  })

  it('rejects missing bundles, mismatched manifests, unsupported files, links, and locales', async () => {
    const root = await fixture()
    expect(() => loadPromptBundle('missing', resolve(root, 'missing'), adapter)).toThrow(/Missing/)
    expect(() => loadPromptBundle('other', resolve(root, 'core'), adapter)).toThrow(/declares core/)

    await writeFile(resolve(root, 'game', 'bad.txt'), 'bad')
    expect(() => loadPromptBundle('game', resolve(root, 'game'), adapter)).toThrow(/Unsupported/)
    await rm(resolve(root, 'game', 'bad.txt'))

    await symlink(resolve(root, 'game', 'turn.njk'), resolve(root, 'game', 'linked.njk'))
    expect(() => loadPromptBundle('game', resolve(root, 'game'), adapter)).toThrow(/symlinks/)
    await rm(resolve(root, 'game', 'linked.njk'))

    await mkdir(resolve(root, 'locale'))
    await writeFile(resolve(root, 'locale', 'copy.njk'), 'copy')
    expect(() => assertPromptRootHasNoLocale(root)).toThrow(/locale axis/)
  })

  it('rejects missing local templates and every unsafe import form', async () => {
    const root = await fixture()
    await writeManifest(root, 'game', {
      id: 'game',
      imports: ['core'],
      references: [{ reference: 'missing.njk', audience: 'public' }],
    })
    expect(() => loadPromptBundle('game', resolve(root, 'game'), adapter)).toThrow(
      /missing template/,
    )

    for (const [source, message] of [
      ['{% include target %}', 'dynamic import'],
      ['{% include "local.njk" %}', 'unqualified import'],
      ['{% include "missing/value.njk" %}', 'undeclared bundle'],
    ] as const) {
      const next = await fixture()
      await writeFile(resolve(next, 'game', 'turn.njk'), source)
      expect(() => validatePromptBundleGraph(loadGraph(next), adapter)).toThrow(message)
    }
  })

  it('rejects missing, cyclic, non-shared, and audience-widening dependencies', async () => {
    const missing = await fixture()
    await writeManifest(missing, 'game', {
      id: 'game',
      imports: ['absent'],
      references: [{ reference: 'turn.njk', audience: 'public' }],
    })
    expect(() =>
      validatePromptBundleGraph(
        [loadPromptBundle('game', resolve(missing, 'game'), adapter)],
        adapter,
      ),
    ).toThrow(/imports missing/)

    const cycle = await fixture()
    await writeManifest(cycle, 'core', {
      id: 'core',
      imports: ['game'],
      shared: [{ reference: 'public.njk', audience: 'public' }],
    })
    expect(() => validatePromptBundleGraph(loadGraph(cycle), adapter)).toThrow(/import cycle/)

    const nonShared = await fixture()
    await writeFile(resolve(nonShared, 'game', 'turn.njk'), '{% include "core/private.njk" %}')
    expect(() => validatePromptBundleGraph(loadGraph(nonShared), adapter)).toThrow(/non-shared/)

    const privateImport = await fixture()
    await writeManifest(privateImport, 'core', {
      id: 'core',
      shared: [{ reference: 'private.njk', audience: 'group' }],
    })
    await writeFile(privateImport + '/game/turn.njk', '{% include "core/private.njk" %}')
    expect(() => validatePromptBundleGraph(loadGraph(privateImport), adapter)).toThrow(
      /cannot import group/,
    )
  })
})

describe('Prompt audience, matcher, and semantic coverage', () => {
  it('enforces the static audience lattice', () => {
    expect(canImportPromptAudience('public', 'public')).toBe(true)
    expect(canImportPromptAudience('participant', 'public')).toBe(true)
    expect(canImportPromptAudience('participant', 'participant')).toBe(true)
    expect(canImportPromptAudience('participant', 'group')).toBe(false)
    expect(canImportPromptAudience('group', 'participant')).toBe(false)
    expect(canImportPromptAudience('host', 'group')).toBe(true)
  })

  it('selects the most specific declarative presentation and fails closed', () => {
    type Event = { type: string; payload: Record<string, unknown> }
    const presentations: PromptPresentation<Event>[] = [
      { owner: 'core', eventType: 'score.changed', where: {}, audience: 'public' },
      {
        owner: 'game',
        eventType: 'score.changed',
        where: { 'detail.group': 'red', optional: { exists: false } },
        audience: 'group',
      },
    ]
    const event = { type: 'score.changed', payload: { detail: { group: 'red' } } }
    const eventAdapter = {
      eventType: (value: Event) => value.type,
      payload: (value: Event) => value.payload,
    }
    expect(selectPromptPresentation(presentations, event, eventAdapter).owner).toBe('game')
    expect(() =>
      selectPromptPresentation(presentations, { type: 'other', payload: {} }, eventAdapter),
    ).toThrow(/No Prompt event presentation/)

    const ambiguous = [presentations[0]!, { ...presentations[0]!, owner: 'other' }]
    expect(() => validatePromptPresentationMatchers(ambiguous)).toThrow(/Ambiguous/)
    expect(() => selectPromptPresentation(ambiguous, event, eventAdapter)).toThrow(/Ambiguous/)
    expect(() => validatePromptPresentationMatchers(presentations)).not.toThrow()
    expect(() =>
      validatePromptPresentationMatchers([
        {
          owner: 'left',
          eventType: 'choice',
          where: { kind: 'left' },
          audience: 'public',
        },
        {
          owner: 'right',
          eventType: 'choice',
          where: { kind: 'right' },
          audience: 'public',
        },
      ]),
    ).not.toThrow()
    expect(
      selectPromptPresentation(
        [
          {
            owner: 'exists',
            eventType: 'choice',
            where: { optional: { exists: true } },
            audience: 'public',
          },
        ],
        { type: 'choice', payload: { optional: 'present' } },
        eventAdapter,
      ).owner,
    ).toBe('exists')
    expect(
      selectPromptPresentation(
        [
          {
            owner: 'missing-array-field',
            eventType: 'array',
            where: { 'items.value': { exists: false } },
            audience: 'public',
          },
        ],
        { type: 'array', payload: { items: [] } },
        eventAdapter,
      ).owner,
    ).toBe('missing-array-field')
  })

  it('checks exact plugin semantic ownership and required presentations', () => {
    const pluginId = PluginIdSchema.parse('plugin-prompt-test')
    const action = SemanticIdSchema.parse('action.prompt-test')
    const options = {
      pluginIds: [pluginId],
      kinds: ['action'] as const,
      contributions: [{ pluginId, semantics: { action: [action] } }],
      claims: [{ pluginId, semantics: { action: [action] } }],
    }
    expect(() => validatePromptSemanticCoverage(options)).not.toThrow()
    expect(() => assertPromptPresentations('actions', [action], [action])).not.toThrow()
    expect(() => validatePromptSemanticCoverage({ ...options, contributions: [] })).toThrow(
      /Missing semantic contribution/,
    )
    expect(() =>
      validatePromptSemanticCoverage({
        ...options,
        contributions: [...options.contributions, ...options.contributions],
      }),
    ).toThrow(/unique plugin IDs/)
    expect(() => validatePromptSemanticCoverage({ ...options, claims: [] })).toThrow(
      /Missing Prompt bundle claim/,
    )
    expect(() =>
      validatePromptSemanticCoverage({
        ...options,
        claims: [...options.claims, ...options.claims],
      }),
    ).toThrow(/unique plugin IDs/)
    expect(() =>
      validatePromptSemanticCoverage({
        ...options,
        claims: [{ pluginId, semantics: { action: [] } }],
      }),
    ).toThrow(/mismatch/)
    expect(() => assertPromptPresentations('actions', [action], [])).toThrow(/mismatch/)
    expect(() =>
      validatePromptSemanticCoverage({
        ...options,
        claims: [
          ...options.claims,
          { pluginId: PluginIdSchema.parse('plugin-extra'), semantics: { action: [] } },
        ],
      }),
    ).toThrow(/not installed/)
  })
})

function loadGraph(root: string): LoadedPromptBundle<Manifest>[] {
  return [
    loadPromptBundle('core', resolve(root, 'core'), adapter),
    loadPromptBundle('game', resolve(root, 'game'), adapter),
  ]
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'arena-prompt-'))
  roots.push(root)
  await mkdir(resolve(root, 'core'))
  await mkdir(resolve(root, 'game'))
  await writeManifest(root, 'core', {
    id: 'core',
    shared: [{ reference: 'public.njk', audience: 'public' }],
  })
  await writeFile(resolve(root, 'core', 'public.njk'), 'public')
  await writeFile(resolve(root, 'core', 'private.njk'), 'private')
  await writeManifest(root, 'game', {
    id: 'game',
    imports: ['core'],
    references: [{ reference: 'turn.njk', audience: 'public' }],
  })
  await writeFile(resolve(root, 'game', 'turn.njk'), '{% include "core/public.njk" %} {{ value }}')
  return root
}

async function writeManifest(
  root: string,
  id: string,
  input: Partial<Manifest> & Pick<Manifest, 'id'>,
): Promise<void> {
  await writeFile(resolve(root, id, 'bundle.json'), JSON.stringify(input))
}
