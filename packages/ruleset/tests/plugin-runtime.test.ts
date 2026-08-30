import { z } from 'zod'
import {
  PluginIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  type SemanticId,
} from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import {
  PhaseGraphRegistry,
  QueryRegistry,
  ResolutionRegistry,
  RulesetBuilder,
  RulesetRegistrar,
  SemanticOwnershipRecorder,
  assertRulesetLock,
  type PhaseNode,
  type RulePlugin,
} from '../src/index.js'

type SemanticKind = 'action' | 'phase' | 'query'

interface TestNode extends PhaseNode<string> {
  readonly label: string
}

type TestEffect =
  | { readonly kind: 'prepare'; readonly value: number }
  | { readonly kind: 'apply'; readonly value: number }

class TestRegistrar extends RulesetRegistrar<SemanticKind> {
  public readonly actions: SemanticId[] = []
  public readonly phases: PhaseGraphRegistry<string, TestNode>
  public readonly queries: QueryRegistry<string, { readonly bonus: number }>
  public readonly resolution: ResolutionRegistry<
    TestEffect,
    'prepare' | 'apply',
    { readonly multiplier: number },
    number,
    number
  >

  public constructor(ownership: SemanticOwnershipRecorder<SemanticKind>) {
    super(ownership)
    this.phases = new PhaseGraphRegistry((id) => this.own('phase', semantic(id)))
    this.queries = new QueryRegistry((type) => this.own('query', semantic(type)))
    this.resolution = new ResolutionRegistry({
      lanes: ['prepare', 'apply'],
      merge: (values) => values.reduce((total, value) => total + value, 0),
    })
  }

  public registerAction(value: string): void {
    const id = semantic(value)
    this.own('action', id)
    this.actions.push(id)
  }
}

function semantic(value: string): SemanticId {
  return SemanticIdSchema.parse(value)
}

describe('Ruleset runtime', () => {
  it('builds ordered plugins, semantic ownership, lock, graph, query, and resolution registries', () => {
    const base: RulePlugin<TestRegistrar> = {
      id: PluginIdSchema.parse('plugin-base'),
      version: 1,
      register: (registrar) => {
        registrar.registerAction('turn.pass')
        registrar.phases.registerBase({
          id: 'round',
          entry: 'phase-end',
          nodes: new Map([['phase-end', { id: 'phase-end', label: 'End', edges: [] }]]),
        })
      },
    }
    const extension: RulePlugin<TestRegistrar> = {
      id: PluginIdSchema.parse('plugin-extension'),
      version: 2,
      config: { bonus: 2 },
      configSchema: z.object({ bonus: z.number().int() }),
      requires: [{ id: base.id, version: 1 }],
      register: (registrar) => {
        registrar.registerAction('turn.score')
        registrar.phases.insert({
          node: { id: 'phase-score', label: 'Score', edges: [] },
          after: null,
          before: 'phase-end',
        })
        registrar.queries.register({
          type: 'query-score',
          inputSchema: z.object({ value: z.number() }),
          resultSchema: z.number(),
          resolve: ({ value }, context) => value + context.bonus,
        })
        registrar.queries.registerModifier({
          id: 'double-score',
          type: 'query-score',
          inputSchema: z.object({ value: z.number() }),
          resultSchema: z.number(),
          transform: (_input, current) => current * 2,
        })
        registrar.resolution.registerEffect({
          kind: 'prepare',
          schema: z.object({ kind: z.literal('prepare'), value: z.number() }),
          lane: 'prepare',
          apply: (effect, _context, frame) => {
            frame.enqueue({ kind: 'apply', value: effect.value })
          },
        })
        registrar.resolution.registerEffect({
          kind: 'apply',
          schema: z.object({ kind: z.literal('apply'), value: z.number() }),
          lane: 'apply',
          apply: (effect, context, frame) => {
            frame.fact('score', () => [] as number[]).push(effect.value * context.multiplier)
          },
        })
        registrar.resolution.registerFinalizer({
          id: 'score-result',
          finalize: (_context, frame) =>
            (frame.read<number[]>('score') ?? []).reduce((total, value) => total + value, 0),
        })
      },
    }

    const runtime = new RulesetBuilder({
      id: RulesetIdSchema.parse('ruleset-conformance'),
      revision: 3,
      semanticKinds: ['action', 'phase', 'query'] as const,
      plugins: [extension, base],
      createRegistrar: (ownership) => new TestRegistrar(ownership),
      finalize: ({ registrar }) => ({
        actions: [...registrar.actions],
        phases: registrar.phases.build(),
        queries: registrar.queries,
        resolution: registrar.resolution,
      }),
    }).build()

    expect(runtime.plugins.map((plugin) => plugin.id)).toEqual(['plugin-base', 'plugin-extension'])
    expect(runtime.implementation.phases.entry).toBe('phase-score')
    expect(runtime.implementation.actions).toEqual(['turn.pass', 'turn.score'])
    expect(runtime.contributions).toEqual([
      {
        pluginId: 'plugin-base',
        semantics: {
          action: ['turn.pass'],
          phase: ['phase-end'],
          query: [],
        },
      },
      {
        pluginId: 'plugin-extension',
        semantics: {
          action: ['turn.score'],
          phase: ['phase-score'],
          query: ['query-score'],
        },
      },
    ])
    expect(runtime.implementation.queries.resolve('query-score', { value: 3 }, { bonus: 2 })).toBe(
      10,
    )
    expect(
      runtime.implementation.resolution.settle([{ kind: 'prepare', value: 4 }], { multiplier: 3 }),
    ).toBe(12)
    expect(runtime.lock).toMatchObject({
      id: 'ruleset-conformance',
      revision: 3,
      plugins: [
        { id: 'plugin-base', version: 1 },
        { id: 'plugin-extension', version: 2, config: { bonus: 2 } },
      ],
    })
    expect(runtime.lock.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(() => assertRulesetLock(runtime.lock, runtime.lock)).not.toThrow()
    expect(() =>
      assertRulesetLock(runtime.lock, { ...runtime.lock, fingerprint: 'f'.repeat(64) }),
    ).toThrow(/fingerprint/)
  })

  it('fails closed for invalid revisions, semantic kinds, ownership, query, and resolution input', () => {
    expect(() => new SemanticOwnershipRecorder(['action', 'action'])).toThrow(/unique/)
    expect(
      () =>
        new RulesetBuilder({
          id: RulesetIdSchema.parse('ruleset-invalid'),
          revision: 0,
          semanticKinds: ['action', 'phase', 'query'] as const,
          plugins: [],
          createRegistrar: (ownership) => new TestRegistrar(ownership),
          finalize: () => ({}),
        }),
    ).toThrow(/invalid revision/)

    const ownership = new SemanticOwnershipRecorder<SemanticKind>(['action', 'phase', 'query'])
    const registrar = new TestRegistrar(ownership)
    expect(() => registrar.registerAction('turn.pass')).toThrow(/active plugin/)
    expect(() => new ResolutionRegistry({ lanes: [], merge: () => 0 })).toThrow(/lanes/)
    expect(() => registrar.queries.resolve('unknown', {}, { bonus: 0 })).toThrow(/Unknown query/)
    expect(() =>
      registrar.resolution.settle([{ kind: 'apply', value: 1 }], { multiplier: 1 }),
    ).toThrow(/Unknown resolution effect/)
  })
})
