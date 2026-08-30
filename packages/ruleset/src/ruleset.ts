import { createHash } from 'node:crypto'
import type {
  JsonValue,
  PluginId,
  RulesetId,
  RulesetLock,
  SemanticId,
} from '@agent-arena/contracts'
import { RulesetLockSchema } from '@agent-arena/contracts'
import {
  installRulePlugins,
  type InstalledPlugin,
  type PluginInstallScope,
  type RulePlugin,
} from './loader.js'
import { SemanticOwnershipRecorder, type PluginSemanticContribution } from './semantic-ownership.js'

export abstract class RulesetRegistrar<Kind extends string> implements PluginInstallScope {
  protected constructor(private readonly ownership: SemanticOwnershipRecorder<Kind>) {}

  public beginPluginInstall(pluginId: PluginId): void {
    this.ownership.begin(pluginId)
  }

  public endPluginInstall(pluginId: PluginId): void {
    this.ownership.end(pluginId)
  }

  protected own(kind: Kind, semanticId: SemanticId): void {
    this.ownership.record(kind, semanticId)
  }
}

export class RulesetRuntime<Kind extends string, Implementation> {
  public constructor(
    public readonly id: RulesetId,
    public readonly revision: number,
    public readonly plugins: readonly InstalledPlugin[],
    public readonly contributions: readonly PluginSemanticContribution<Kind>[],
    public readonly lock: RulesetLock,
    public readonly implementation: Implementation,
  ) {}
}

export interface RulesetBuilderOptions<
  Kind extends string,
  Registrar extends RulesetRegistrar<Kind>,
  Implementation,
> {
  readonly id: RulesetId
  readonly revision: number
  readonly semanticKinds: readonly Kind[]
  readonly plugins: readonly RulePlugin<Registrar>[]
  createRegistrar(ownership: SemanticOwnershipRecorder<Kind>): Registrar
  finalize(input: {
    readonly registrar: Registrar
    readonly plugins: readonly InstalledPlugin[]
    readonly contributions: readonly PluginSemanticContribution<Kind>[]
    readonly lock: RulesetLock
  }): Implementation
}

export class RulesetBuilder<
  Kind extends string,
  Registrar extends RulesetRegistrar<Kind>,
  Implementation,
> {
  readonly #options: RulesetBuilderOptions<Kind, Registrar, Implementation>

  public constructor(options: RulesetBuilderOptions<Kind, Registrar, Implementation>) {
    if (!Number.isInteger(options.revision) || options.revision < 1) {
      throw new Error(`Ruleset ${options.id} has invalid revision ${options.revision}`)
    }
    this.#options = options
  }

  public build(): RulesetRuntime<Kind, Implementation> {
    const ownership = new SemanticOwnershipRecorder(this.#options.semanticKinds)
    const registrar = this.#options.createRegistrar(ownership)
    const plugins = installRulePlugins(registrar, this.#options.plugins)
    const contributions = ownership.contributions(plugins.map((plugin) => plugin.id))
    const lock = createRulesetLock(this.#options.id, this.#options.revision, plugins)
    const implementation = this.#options.finalize({ registrar, plugins, contributions, lock })
    return new RulesetRuntime(
      this.#options.id,
      this.#options.revision,
      plugins,
      contributions,
      lock,
      implementation,
    )
  }
}

export function createRulesetLock(
  id: RulesetId,
  revision: number,
  installed: readonly InstalledPlugin[],
): RulesetLock {
  const plugins = installed.map((plugin) => ({
    id: plugin.id,
    version: plugin.version,
    config: plugin.config,
    configHash: digest(plugin.config),
  }))
  return RulesetLockSchema.parse({
    id,
    revision,
    plugins,
    fingerprint: digest({ id, revision, plugins }),
  })
}

export function assertRulesetLock(expected: RulesetLock, actual: RulesetLock): void {
  if (expected.id !== actual.id || expected.revision !== actual.revision) {
    throw new Error(
      `Ruleset release mismatch: expected ${expected.id}@${expected.revision}, received ${actual.id}@${actual.revision}`,
    )
  }
  if (expected.fingerprint !== actual.fingerprint) {
    throw new Error(`Ruleset fingerprint mismatch for ${expected.id}`)
  }
}

function digest(value: JsonValue | Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
