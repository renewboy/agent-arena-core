import type { PluginId, SemanticId } from '@agent-arena/contracts'

export interface PluginSemanticContribution<Kind extends string> {
  readonly pluginId: PluginId
  readonly semantics: Readonly<Record<Kind, readonly SemanticId[]>>
}

type MutableContribution<Kind extends string> = Map<Kind, SemanticId[]>

export class SemanticOwnershipRecorder<Kind extends string> {
  readonly #kinds: readonly Kind[]
  readonly #byPlugin = new Map<PluginId, MutableContribution<Kind>>()
  #activePluginId: PluginId | null = null

  public constructor(kinds: readonly Kind[]) {
    if (new Set(kinds).size !== kinds.length) {
      throw new Error('Semantic ownership kinds must be unique')
    }
    this.#kinds = [...kinds]
  }

  public begin(pluginId: PluginId): void {
    if (this.#activePluginId) {
      throw new Error(`Plugin ${pluginId} cannot install while ${this.#activePluginId} is active`)
    }
    if (this.#byPlugin.has(pluginId)) throw new Error(`Plugin ${pluginId} installed twice`)
    this.#activePluginId = pluginId
    this.#byPlugin.set(pluginId, new Map(this.#kinds.map((kind) => [kind, []])))
  }

  public end(pluginId: PluginId): void {
    if (this.#activePluginId !== pluginId) {
      throw new Error(
        `Plugin install scope mismatch: expected ${this.#activePluginId}, got ${pluginId}`,
      )
    }
    this.#activePluginId = null
  }

  public record(kind: Kind, semanticId: SemanticId): void {
    const values = this.#active().get(kind)
    if (!values) throw new Error(`Unknown semantic ownership kind ${kind}`)
    pushUnique(values, semanticId, kind)
  }

  public contributions(
    pluginIds: readonly PluginId[],
  ): readonly PluginSemanticContribution<Kind>[] {
    if (this.#activePluginId)
      throw new Error(`Plugin ${this.#activePluginId} install is unfinished`)
    return pluginIds.map((pluginId) => {
      const contribution = this.#byPlugin.get(pluginId)
      if (!contribution) throw new Error(`Plugin ${pluginId} has no semantic install record`)
      return Object.freeze({
        pluginId,
        semantics: Object.freeze(
          Object.fromEntries(
            this.#kinds.map((kind) => [kind, Object.freeze([...(contribution.get(kind) ?? [])])]),
          ) as Record<Kind, readonly SemanticId[]>,
        ),
      })
    })
  }

  #owner(): PluginId {
    if (!this.#activePluginId) throw new Error('Semantic registration requires an active plugin')
    return this.#activePluginId
  }

  #active(): MutableContribution<Kind> {
    const owner = this.#owner()
    const contribution = this.#byPlugin.get(owner)
    if (!contribution) throw new Error(`Missing semantic install record for ${owner}`)
    return contribution
  }
}

function pushUnique<Value extends string>(values: Value[], value: Value, label: string): void {
  if (values.includes(value)) throw new Error(`${label} ${value} registered twice in one plugin`)
  values.push(value)
}
