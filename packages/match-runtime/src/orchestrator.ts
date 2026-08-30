import type {
  GameAction,
  GameEvent,
  JsonValue,
  MatchId,
  ParticipantId,
  SessionBindingStore,
} from '@agent-arena/contracts'
import type {
  DecisionActor,
  DecisionBoundary,
  GameMachine,
  GameModule,
  GameObservation,
} from '@agent-arena/game-runtime'
import { ActionGateway } from './action-gateway.js'

export interface ParticipantTurnContext<Facts> {
  readonly matchId: MatchId
  readonly participantId: ParticipantId
  readonly actor: DecisionActor
  readonly boundary: DecisionBoundary
  readonly observation: GameObservation<Facts>
  readonly token: string
  readonly gateway: ActionGateway
}

export interface ParticipantTurnDriver<Facts> {
  takeTurn(context: ParticipantTurnContext<Facts>): Promise<void>
}

export interface MatchOrchestratorOptions<Setup, State, Facts, Outcome extends JsonValue> {
  readonly module: GameModule<Setup, State, Facts, Outcome>
  readonly machine: GameMachine<State, Outcome>
  readonly driver: ParticipantTurnDriver<Facts>
  readonly gateway?: ActionGateway
  readonly sessions?: SessionBindingStore
  readonly boundaryExecutor?: BoundaryExecutor<Setup, State, Facts, Outcome>
  readonly beforeSubmit?: (
    boundary: DecisionBoundary,
    actions: readonly GameAction[],
  ) => void | Promise<void>
  readonly onEvents?: (events: readonly GameEvent[]) => void | Promise<void>
  readonly onFailure?: (error: unknown, boundary: DecisionBoundary) => void | Promise<void>
}

export interface BoundaryExecutionContext<Setup, State, Facts, Outcome extends JsonValue> {
  readonly boundary: DecisionBoundary
  readonly module: GameModule<Setup, State, Facts, Outcome>
  readonly machine: GameMachine<State, Outcome>
  runDefault(): Promise<DecisionRunResult<Outcome>>
}

export interface BoundaryExecutor<Setup, State, Facts, Outcome extends JsonValue> {
  execute(
    context: BoundaryExecutionContext<Setup, State, Facts, Outcome>,
  ): Promise<DecisionRunResult<Outcome>>
}

export interface DecisionRunResult<Outcome extends JsonValue> {
  readonly boundary: DecisionBoundary
  readonly actions: readonly GameAction[]
  readonly events: readonly GameEvent[]
  readonly outcome: Outcome | null
}

export class MatchOrchestrator<Setup, State, Facts, Outcome extends JsonValue> {
  readonly #options: MatchOrchestratorOptions<Setup, State, Facts, Outcome>
  readonly #gateway: ActionGateway
  readonly #tokens = new Map<ParticipantId, string>()

  public constructor(options: MatchOrchestratorOptions<Setup, State, Facts, Outcome>) {
    this.#options = options
    this.#gateway = options.gateway ?? new ActionGateway()
  }

  public get machine(): GameMachine<State, Outcome> {
    return this.#options.machine
  }

  public async runDecision(): Promise<DecisionRunResult<Outcome> | null> {
    const boundary = this.machine.currentDecision()
    if (!boundary) return null
    try {
      return this.#options.boundaryExecutor
        ? await this.#options.boundaryExecutor.execute({
            boundary,
            module: this.#options.module,
            machine: this.machine,
            runDefault: () => this.#runDefault(boundary),
          })
        : await this.#runDefault(boundary)
    } catch (error) {
      await this.#options.onFailure?.(error, boundary)
      throw new MatchOrchestrationError(
        `Decision ${boundary.id} failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
  }

  async #runDefault(boundary: DecisionBoundary): Promise<DecisionRunResult<Outcome>> {
    const matchId = this.machine.matchId
    this.#gateway.open(matchId, boundary, (participantId, action) => {
      this.#options.sessions?.savePendingAction(matchId, participantId, boundary.id, action)
    })
    try {
      const pending = new Set<ParticipantId>()
      for (const actor of boundary.actors) {
        const saved = this.#options.sessions?.get(matchId, actor.participantId)?.pendingAction
        if (saved?.decisionId === boundary.id) {
          this.#gateway.restore(matchId, boundary, saved.action)
        } else {
          pending.add(actor.participantId)
        }
      }
      const contexts = boundary.actors
        .filter((actor) => pending.has(actor.participantId))
        .map((actor) => this.#context(boundary, actor))
      await Promise.all(contexts.map((context) => this.#options.driver.takeTurn(context)))
      const actions = this.#gateway.seal(matchId, boundary)
      if (!actions) {
        throw new Error(
          `Decision ${boundary.id} is missing actors: ${this.#gateway.pendingActors(matchId, boundary).join(', ')}`,
        )
      }
      await this.#options.beforeSubmit?.(boundary, actions)
      const events = this.machine.submit(actions)
      await this.#options.onEvents?.(events)
      for (const actor of boundary.actors) {
        if (this.#options.sessions?.get(matchId, actor.participantId)) {
          this.#options.sessions.clearPendingAction(matchId, actor.participantId)
        }
      }
      return { boundary, actions, events, outcome: this.machine.outcome }
    } finally {
      this.#gateway.close(matchId, boundary)
    }
  }

  public async runUntilOutcome(maxDecisions = 200): Promise<Outcome> {
    for (let index = 0; index < maxDecisions; index += 1) {
      if (this.machine.outcome !== null) return this.machine.outcome
      const result = await this.runDecision()
      if (!result) break
    }
    if (this.machine.outcome === null) {
      throw new MatchOrchestrationError(`Match ${this.machine.matchId} did not reach an outcome`)
    }
    return this.machine.outcome
  }

  public close(): void {
    for (const token of this.#tokens.values()) this.#gateway.revokeToken(token)
    this.#tokens.clear()
  }

  #context(boundary: DecisionBoundary, actor: DecisionActor): ParticipantTurnContext<Facts> {
    const observation = this.#options.module.observe(this.machine, {
      kind: 'participant',
      participantId: actor.participantId,
    })
    if (observation.revision !== boundary.observationRevision) {
      throw new Error(
        `Observation ${observation.revision} does not match decision ${boundary.observationRevision}`,
      )
    }
    return {
      matchId: this.machine.matchId,
      participantId: actor.participantId,
      actor,
      boundary,
      observation,
      token: this.#token(actor.participantId),
      gateway: this.#gateway,
    }
  }

  #token(participantId: ParticipantId): string {
    const existing = this.#tokens.get(participantId)
    if (existing) return existing
    const token = this.#gateway.issueToken(this.machine.matchId, participantId)
    this.#tokens.set(participantId, token)
    return token
  }
}

export class MatchOrchestrationError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MatchOrchestrationError'
  }
}
