import { z } from 'zod'
import { PluginIdSchema, SemanticIdSchema } from '@agent-arena/contracts'
import { describe, expect, it } from 'vitest'
import {
  QueryRegistry,
  ResolutionRegistry,
  SemanticOwnershipRecorder,
  type ResolutionEffect,
  type ResolutionFrame,
} from '../src/index.js'

describe('semantic ownership failures', () => {
  it('rejects overlapping scopes, mismatched owners, unknown kinds, duplicates, and missing records', () => {
    const ownership = new SemanticOwnershipRecorder(['action', 'event'] as const)
    const one = PluginIdSchema.parse('plugin-one')
    const two = PluginIdSchema.parse('plugin-two')
    ownership.begin(one)
    expect(() => ownership.begin(two)).toThrow(/while plugin-one is active/)
    expect(() => ownership.end(two)).toThrow(/scope mismatch/)
    expect(() => ownership.contributions([one])).toThrow(/unfinished/)
    ownership.record('action', SemanticIdSchema.parse('turn.pass'))
    expect(() => ownership.record('action', SemanticIdSchema.parse('turn.pass'))).toThrow(
      /registered twice/,
    )
    expect(() =>
      ownership.record('missing' as never, SemanticIdSchema.parse('turn.other')),
    ).toThrow(/Unknown semantic ownership kind/)
    ownership.end(one)
    expect(() => ownership.begin(one)).toThrow(/installed twice/)
    expect(() => ownership.contributions([two])).toThrow(/no semantic install record/)
  })
})

describe('query registry failures and ordering', () => {
  it('orders modifiers and rejects duplicate or schema-invalid registrations', () => {
    const registered: string[] = []
    const queries = new QueryRegistry<'score', { readonly bonus: number }>((type) =>
      registered.push(type),
    )
    const definition = {
      type: 'score' as const,
      inputSchema: z.object({ value: z.number() }),
      resultSchema: z.number(),
      resolve: ({ value }: { value: number }, context: { bonus: number }) => value + context.bonus,
    }
    queries.register(definition)
    expect(() => queries.register(definition)).toThrow(/Duplicate query/)
    queries.registerModifier({
      id: 'later',
      type: 'score',
      order: 10,
      inputSchema: definition.inputSchema,
      resultSchema: definition.resultSchema,
      transform: (_input, current) => current + 1,
    })
    queries.registerModifier({
      id: 'earlier',
      type: 'score',
      inputSchema: definition.inputSchema,
      resultSchema: definition.resultSchema,
      transform: (_input, current) => current * 2,
    })
    expect(() =>
      queries.registerModifier({
        id: 'later',
        type: 'score',
        inputSchema: definition.inputSchema,
        resultSchema: definition.resultSchema,
        transform: (_input, current) => current,
      }),
    ).toThrow(/Duplicate query modifier/)
    expect(queries.resolve('score', { value: 2 }, { bonus: 1 })).toBe(7)
    expect(registered).toEqual(['score'])
    expect(() => queries.resolve('score', { value: 'bad' }, { bonus: 1 })).toThrow()
  })
})

type Effect =
  | { readonly kind: 'first'; readonly value: number }
  | { readonly kind: 'second'; readonly value: number }
  | { readonly kind: 'loop' }

interface Contribution {
  readonly value: number
}

function registry(maxSteps?: number) {
  return new ResolutionRegistry<
    Effect,
    'prepare' | 'apply',
    { readonly scale: number },
    Contribution,
    number
  >({
    lanes: ['prepare', 'apply'],
    ...(maxSteps === undefined ? {} : { maxSteps }),
    merge: (contributions) => contributions.reduce((total, entry) => total + entry.value, 0),
  })
}

describe('resolution registry failures and ordering', () => {
  it('validates definitions, schemas, finalizers, lanes, and bounded dynamic enqueue', () => {
    expect(
      () =>
        new ResolutionRegistry<ResolutionEffect, string, unknown, number, number>({
          lanes: ['same', 'same'],
          merge: (values) => values.reduce((total, value) => total + value, 0),
        }),
    ).toThrow(/unique values/)

    const resolution = registry()
    const first = {
      kind: 'first' as const,
      schema: z.object({ kind: z.literal('first'), value: z.number() }),
      lane: 'prepare' as const,
      apply: (
        effect: Extract<Effect, { kind: 'first' }>,
        _context: { readonly scale: number },
        frame: ResolutionFrame<Effect>,
      ) => frame.enqueue({ kind: 'second', value: effect.value }),
    }
    resolution.registerEffect(first)
    expect(() => resolution.registerEffect(first)).toThrow(/Duplicate effect/)
    resolution.registerEffect({
      kind: 'second',
      schema: z.object({ kind: z.literal('second'), value: z.number() }),
      lane: 'apply',
      apply: (effect, context, frame) => {
        frame.fact('values', () => [] as number[]).push(effect.value * context.scale)
      },
    })
    resolution.registerFinalizer({
      id: 'later',
      order: 10,
      finalize: () => ({ value: 1 }),
    })
    resolution.registerFinalizer({
      id: 'values',
      finalize: (_context, frame) => ({
        value: (frame.read<number[]>('values') ?? []).reduce((total, value) => total + value, 0),
      }),
    })
    expect(() =>
      resolution.registerFinalizer({ id: 'values', finalize: () => ({ value: 0 }) }),
    ).toThrow(/Duplicate resolution finalizer/)
    expect(resolution.settle([{ kind: 'first', value: 2 }], { scale: 3 })).toBe(7)
    expect(() => resolution.settle([{ kind: 'first', value: Number.NaN }], { scale: 1 })).toThrow()
    expect(() => resolution.settle([{ kind: 'loop' }], { scale: 1 })).toThrow(/Unknown resolution/)

    const bounded = registry(1)
    bounded.registerEffect({
      kind: 'loop',
      schema: z.object({ kind: z.literal('loop') }),
      lane: 'prepare',
      apply: (effect, _context, frame) => frame.enqueue(effect),
    })
    expect(() => bounded.settle([{ kind: 'loop' }], { scale: 1 })).toThrow(/exceeded 1 steps/)
  })

  it('rejects unknown, cross-lane, and cyclic ordering dependencies', () => {
    const unknown = registry()
    unknown.registerEffect({
      kind: 'first',
      schema: z.object({ kind: z.literal('first'), value: z.number() }),
      lane: 'prepare',
      after: ['second'],
      apply: () => undefined,
    })
    expect(() => unknown.settle([{ kind: 'first', value: 1 }], { scale: 1 })).toThrow(
      /orders against unknown/,
    )

    const crossLane = registry()
    crossLane.registerEffect({
      kind: 'first',
      schema: z.object({ kind: z.literal('first'), value: z.number() }),
      lane: 'prepare',
      before: ['second'],
      apply: () => undefined,
    })
    crossLane.registerEffect({
      kind: 'second',
      schema: z.object({ kind: z.literal('second'), value: z.number() }),
      lane: 'apply',
      apply: () => undefined,
    })
    expect(() => crossLane.settle([{ kind: 'first', value: 1 }], { scale: 1 })).toThrow(
      /cannot order across/,
    )

    const cycle = registry()
    cycle.registerEffect({
      kind: 'first',
      schema: z.object({ kind: z.literal('first'), value: z.number() }),
      lane: 'prepare',
      after: ['second'],
      apply: () => undefined,
    })
    cycle.registerEffect({
      kind: 'second',
      schema: z.object({ kind: z.literal('second'), value: z.number() }),
      lane: 'prepare',
      after: ['first'],
      apply: () => undefined,
    })
    expect(() => cycle.settle([{ kind: 'first', value: 1 }], { scale: 1 })).toThrow(
      /ordering cycle/,
    )
  })
})
