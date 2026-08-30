import type { JsonValue } from '@agent-arena/contracts'
import type { z } from 'zod'

export interface QueryDefinition<
  Type extends string,
  Context,
  Input extends JsonValue,
  Result extends JsonValue,
> {
  readonly type: Type
  readonly inputSchema: z.ZodType<Input>
  readonly resultSchema: z.ZodType<Result>
  resolve(input: Input, context: Context): Result
}

export interface QueryModifier<
  Type extends string,
  Context,
  Input extends JsonValue,
  Result extends JsonValue,
> {
  readonly id: string
  readonly type: Type
  readonly order?: number
  readonly inputSchema: z.ZodType<Input>
  readonly resultSchema: z.ZodType<Result>
  transform(input: Input, current: Result, context: Context): Result
}

interface StoredQueryDefinition<Type extends string, Context> {
  readonly type: Type
  parseInput(value: unknown): JsonValue
  resolve(input: JsonValue, context: Context): JsonValue
}

interface StoredQueryModifier<Type extends string, Context> {
  readonly id: string
  readonly type: Type
  readonly order: number
  readonly sequence: number
  transform(input: JsonValue, current: JsonValue, context: Context): JsonValue
}

export class QueryRegistry<Type extends string = string, Context = unknown> {
  readonly #definitions = new Map<Type, StoredQueryDefinition<Type, Context>>()
  readonly #modifiers: Array<StoredQueryModifier<Type, Context>> = []
  #sequence = 0

  public constructor(private readonly onRegister?: (type: Type) => void) {}

  public register<Input extends JsonValue, Result extends JsonValue>(
    definition: QueryDefinition<Type, Context, Input, Result>,
  ): void {
    if (this.#definitions.has(definition.type)) {
      throw new Error(`Duplicate query definition ${definition.type}`)
    }
    this.onRegister?.(definition.type)
    this.#definitions.set(definition.type, {
      type: definition.type,
      parseInput: (value) => definition.inputSchema.parse(value),
      resolve: (input, context) =>
        definition.resultSchema.parse(
          definition.resolve(definition.inputSchema.parse(input), context),
        ),
    })
  }

  public registerModifier<Input extends JsonValue, Result extends JsonValue>(
    modifier: QueryModifier<Type, Context, Input, Result>,
  ): void {
    if (this.#modifiers.some((entry) => entry.id === modifier.id)) {
      throw new Error(`Duplicate query modifier ${modifier.id}`)
    }
    this.#modifiers.push({
      id: modifier.id,
      type: modifier.type,
      order: modifier.order ?? 0,
      sequence: ++this.#sequence,
      transform: (input, current, context) =>
        modifier.resultSchema.parse(
          modifier.transform(
            modifier.inputSchema.parse(input),
            modifier.resultSchema.parse(current),
            context,
          ),
        ),
    })
  }

  public resolve<Result extends JsonValue>(
    type: Type,
    input: JsonValue,
    context: Context,
    _resultSchema?: z.ZodType<Result>,
  ): Result {
    const definition = this.#definitions.get(type)
    if (!definition) throw new Error(`Unknown query ${type}`)
    const parsedInput = definition.parseInput(input)
    let result = definition.resolve(parsedInput, context)
    for (const modifier of this.#modifiers
      .filter((entry) => entry.type === type)
      .sort((left, right) => left.order - right.order || left.sequence - right.sequence)) {
      result = modifier.transform(parsedInput, result, context)
    }
    return result as Result
  }
}
