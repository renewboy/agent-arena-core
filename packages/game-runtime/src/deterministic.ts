import { assertRule } from './errors.js'

export type DeterministicIndexResolver = (key: string, length: number) => number

export function deterministicIndex(key: string, length: number): number {
  assertRule(length > 0, 'Deterministic selection requires at least one value')
  let hash = 0x811c_9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index)
    hash = Math.imul(hash, 0x0100_0193)
  }
  return (hash >>> 0) % length
}

export class SeededRandom {
  #state: number

  public constructor(seed: number) {
    this.#state = seed >>> 0 || 0x9e37_79b9
  }

  public get state(): number {
    return this.#state
  }

  public next(): number {
    let value = this.#state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.#state = value >>> 0
    return this.#state / 0x1_0000_0000
  }
}

export function shuffled<Value>(values: readonly Value[], random: SeededRandom): Value[] {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random.next() * (index + 1))
    const current = result[index]!
    result[index] = result[swapIndex]!
    result[swapIndex] = current
  }
  return result
}
