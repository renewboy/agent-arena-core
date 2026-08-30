import type { z } from 'zod'

export interface ResolutionEffect {
  readonly kind: string
}

export class ResolutionFrame<Effect extends ResolutionEffect> {
  readonly #facts = new Map<string, unknown>()
  readonly #enqueue: (effect: Effect) => void

  public constructor(enqueue: (effect: Effect) => void) {
    this.#enqueue = enqueue
  }

  public enqueue(effect: Effect): void {
    this.#enqueue(effect)
  }

  public fact<Value>(key: string, create: () => Value): Value {
    if (!this.#facts.has(key)) this.#facts.set(key, create())
    return this.#facts.get(key) as Value
  }

  public read<Value>(key: string, _fallback?: Value): Value | undefined {
    return this.#facts.get(key) as Value | undefined
  }
}

export interface EffectDefinition<
  Effect extends ResolutionEffect,
  ConcreteEffect extends Effect,
  Lane extends string,
  Context,
> {
  readonly kind: ConcreteEffect['kind']
  readonly schema: z.ZodType<ConcreteEffect>
  readonly lane: Lane
  readonly before?: readonly Effect['kind'][]
  readonly after?: readonly Effect['kind'][]
  apply(effect: ConcreteEffect, context: Context, frame: ResolutionFrame<Effect>): void
}

export interface ResolutionFinalizer<Effect extends ResolutionEffect, Context, Contribution> {
  readonly id: string
  readonly order?: number
  finalize(context: Context, frame: ResolutionFrame<Effect>): Contribution
}

interface StoredEffectDefinition<Effect extends ResolutionEffect, Lane extends string, Context> {
  readonly kind: Effect['kind']
  readonly lane: Lane
  readonly before: readonly Effect['kind'][]
  readonly after: readonly Effect['kind'][]
  readonly sequence: number
  parse(input: unknown): Effect
  apply(effect: Effect, context: Context, frame: ResolutionFrame<Effect>): void
}

interface QueuedEffect<Effect extends ResolutionEffect> {
  readonly effect: Effect
  readonly sequence: number
}

export interface ResolutionRegistryOptions<Lane extends string, Contribution, Result> {
  readonly lanes: readonly Lane[]
  readonly maxSteps?: number
  merge(contributions: readonly Contribution[]): Result
}

export class ResolutionRegistry<
  Effect extends ResolutionEffect,
  Lane extends string,
  Context,
  Contribution,
  Result,
> {
  readonly #effects = new Map<Effect['kind'], StoredEffectDefinition<Effect, Lane, Context>>()
  readonly #finalizers: Array<
    ResolutionFinalizer<Effect, Context, Contribution> & { sequence: number }
  > = []
  readonly #options: ResolutionRegistryOptions<Lane, Contribution, Result>
  #registrationSequence = 0

  public constructor(options: ResolutionRegistryOptions<Lane, Contribution, Result>) {
    if (options.lanes.length === 0 || new Set(options.lanes).size !== options.lanes.length) {
      throw new Error('Resolution lanes must contain unique values')
    }
    this.#options = options
  }

  public registerEffect<ConcreteEffect extends Effect>(
    definition: EffectDefinition<Effect, ConcreteEffect, Lane, Context>,
  ): void {
    if (this.#effects.has(definition.kind)) {
      throw new Error(`Duplicate effect definition ${definition.kind}`)
    }
    this.#effects.set(definition.kind, {
      kind: definition.kind,
      lane: definition.lane,
      before: definition.before ?? [],
      after: definition.after ?? [],
      sequence: ++this.#registrationSequence,
      parse: (input) => definition.schema.parse(input),
      apply: (effect, context, frame) => definition.apply(effect as ConcreteEffect, context, frame),
    })
  }

  public registerFinalizer(finalizer: ResolutionFinalizer<Effect, Context, Contribution>): void {
    if (this.#finalizers.some((entry) => entry.id === finalizer.id)) {
      throw new Error(`Duplicate resolution finalizer ${finalizer.id}`)
    }
    this.#finalizers.push({ ...finalizer, sequence: ++this.#registrationSequence })
  }

  public settle(initialEffects: readonly Effect[], context: Context): Result {
    const definitionOrder = this.#definitionOrder()
    const queue: Array<QueuedEffect<Effect>> = []
    let enqueueSequence = 0
    const enqueue = (effect: Effect): void => {
      const definition = this.#effects.get(effect.kind)
      if (!definition) throw new Error(`Unknown resolution effect ${effect.kind}`)
      queue.push({ effect: definition.parse(effect), sequence: ++enqueueSequence })
    }
    const frame = new ResolutionFrame<Effect>(enqueue)
    for (const effect of initialEffects) enqueue(effect)

    let steps = 0
    while (queue.length > 0) {
      const maxSteps = this.#options.maxSteps ?? 1_000
      if (++steps > maxSteps) throw new Error(`Resolution queue exceeded ${maxSteps} steps`)
      queue.sort((left, right) => {
        const leftDefinition = this.#effects.get(left.effect.kind)!
        const rightDefinition = this.#effects.get(right.effect.kind)!
        return (
          this.#options.lanes.indexOf(leftDefinition.lane) -
            this.#options.lanes.indexOf(rightDefinition.lane) ||
          definitionOrder.get(leftDefinition.kind)! - definitionOrder.get(rightDefinition.kind)! ||
          left.sequence - right.sequence
        )
      })
      const current = queue.shift()!
      const definition = this.#effects.get(current.effect.kind)!
      definition.apply(current.effect, context, frame)
    }

    const contributions = [...this.#finalizers]
      .sort(
        (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.sequence - right.sequence,
      )
      .map((finalizer) => finalizer.finalize(context, frame))
    return this.#options.merge(contributions)
  }

  #definitionOrder(): ReadonlyMap<Effect['kind'], number> {
    const definitions = [...this.#effects.values()]
    const byKind = new Map(definitions.map((definition) => [definition.kind, definition]))
    for (const definition of definitions) {
      for (const dependency of [...definition.before, ...definition.after]) {
        const target = byKind.get(dependency)
        if (!target) {
          throw new Error(`Effect ${definition.kind} orders against unknown ${dependency}`)
        }
        if (target.lane !== definition.lane) {
          throw new Error(
            `Effect ${definition.kind} cannot order across ${definition.lane}/${target.lane} lanes`,
          )
        }
      }
    }

    const visiting = new Set<Effect['kind']>()
    const visited = new Set<Effect['kind']>()
    const ordered: Array<StoredEffectDefinition<Effect, Lane, Context>> = []
    const visit = (
      definition: StoredEffectDefinition<Effect, Lane, Context>,
      path: readonly Effect['kind'][],
    ): void => {
      if (visited.has(definition.kind)) return
      if (visiting.has(definition.kind)) {
        throw new Error(`Effect ordering cycle: ${[...path, definition.kind].join(' -> ')}`)
      }
      visiting.add(definition.kind)
      const dependencies = definitions
        .filter(
          (candidate) =>
            definition.after.includes(candidate.kind) || candidate.before.includes(definition.kind),
        )
        .sort((left, right) => left.sequence - right.sequence)
      for (const dependency of dependencies) visit(dependency, [...path, definition.kind])
      visiting.delete(definition.kind)
      visited.add(definition.kind)
      ordered.push(definition)
    }
    for (const definition of definitions.sort((left, right) => left.sequence - right.sequence)) {
      visit(definition, [])
    }
    return new Map(ordered.map((definition, index) => [definition.kind, index]))
  }
}
