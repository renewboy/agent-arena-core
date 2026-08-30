import { randomBytes } from 'node:crypto'
import {
  GameActionSchema,
  MatchIdSchema,
  ParticipantIdSchema,
  type GameAction,
  type JsonValue,
  type MatchId,
  type ParticipantId,
} from '@agent-arena/contracts'
import {
  validateDecisionAction,
  validateDecisionBatch,
  type DecisionActor,
  type DecisionBoundary,
} from '@agent-arena/game-runtime'

export interface ActionGatewayReceipt {
  readonly accepted: true
  readonly actionId: string
}

interface GatewayBinding {
  readonly matchId: MatchId
  readonly participantId: ParticipantId
}

interface GatewayExpectation {
  readonly matchId: MatchId
  readonly boundary: DecisionBoundary
  readonly actor: DecisionActor
  readonly onAccepted?: (action: GameAction) => void
}

export class ActionGateway {
  readonly #bindings = new Map<string, GatewayBinding>()
  readonly #expectations = new Map<string, GatewayExpectation>()
  readonly #actions = new Map<string, GameAction>()

  public issueToken(matchId: MatchId, participantId: ParticipantId): string {
    const token = randomBytes(32).toString('base64url')
    this.#bindings.set(token, {
      matchId: MatchIdSchema.parse(matchId),
      participantId: ParticipantIdSchema.parse(participantId),
    })
    return token
  }

  public revokeToken(token: string): void {
    const binding = this.#bindings.get(token)
    this.#bindings.delete(token)
    if (binding) this.clear(binding.matchId, binding.participantId)
  }

  public open(
    matchId: MatchId,
    boundary: DecisionBoundary,
    onAccepted?: (participantId: ParticipantId, action: GameAction) => void,
  ): void {
    for (const actor of boundary.actors) {
      const key = gatewayKey(matchId, actor.participantId)
      this.#actions.delete(key)
      this.#expectations.set(key, {
        matchId,
        boundary,
        actor,
        ...(onAccepted ? { onAccepted: (action) => onAccepted(actor.participantId, action) } : {}),
      })
    }
  }

  public submitTool(token: string, toolName: string, payload: JsonValue): ActionGatewayReceipt {
    const expectation = this.#expectation(token)
    const spec = expectation.actor.actions.find((candidate) => candidate.toolName === toolName)
    if (!spec)
      throw new Error(`Tool ${toolName} is unavailable for ${expectation.actor.participantId}`)
    if (spec.inputMode === 'text') throw new Error(`Tool ${toolName} only accepts direct text`)
    return this.#accept(
      expectation,
      GameActionSchema.parse({
        matchId: expectation.matchId,
        decisionId: expectation.boundary.id,
        actorId: expectation.actor.participantId,
        actionType: spec.actionType,
        payload,
      }),
    )
  }

  public submitText(token: string, text: string): ActionGatewayReceipt {
    const expectation = this.#expectation(token)
    const candidates = expectation.actor.actions.filter(
      (candidate) => candidate.inputMode === 'text' || candidate.inputMode === 'either',
    )
    if (candidates.length !== 1) {
      throw new Error(
        `Direct text for ${expectation.actor.participantId} requires exactly one text action`,
      )
    }
    return this.#accept(
      expectation,
      GameActionSchema.parse({
        matchId: expectation.matchId,
        decisionId: expectation.boundary.id,
        actorId: expectation.actor.participantId,
        actionType: candidates[0]!.actionType,
        payload: candidates[0]!.textInput?.(text) ?? text,
      }),
    )
  }

  public restore(matchId: MatchId, boundary: DecisionBoundary, action: GameAction): void {
    const parsed = validateDecisionAction(boundary, action)
    if (parsed.matchId !== matchId) throw new Error(`Pending action belongs to another Match`)
    const key = gatewayKey(matchId, parsed.actorId)
    if (!this.#expectations.has(key)) throw new Error(`No action expectation for ${parsed.actorId}`)
    this.#actions.set(key, parsed)
  }

  public seal(matchId: MatchId, boundary: DecisionBoundary): readonly GameAction[] | null {
    const actions = boundary.actors.flatMap((actor) => {
      const action = this.#actions.get(gatewayKey(matchId, actor.participantId))
      return action ? [action] : []
    })
    if (actions.length !== boundary.actors.length) return null
    return validateDecisionBatch(boundary, actions)
  }

  public pendingActors(matchId: MatchId, boundary: DecisionBoundary): readonly ParticipantId[] {
    return boundary.actors
      .filter((actor) => !this.#actions.has(gatewayKey(matchId, actor.participantId)))
      .map((actor) => actor.participantId)
  }

  public close(matchId: MatchId, boundary: DecisionBoundary): void {
    for (const actor of boundary.actors) this.clear(matchId, actor.participantId)
  }

  public clear(matchId: MatchId, participantId: ParticipantId): void {
    const key = gatewayKey(matchId, participantId)
    this.#actions.delete(key)
    this.#expectations.delete(key)
  }

  #expectation(token: string): GatewayExpectation {
    const binding = this.#bindings.get(token)
    if (!binding) throw new Error('Action token is invalid')
    const expectation = this.#expectations.get(gatewayKey(binding.matchId, binding.participantId))
    if (!expectation) throw new Error('The Match host is not waiting for this participant')
    return expectation
  }

  #accept(expectation: GatewayExpectation, input: GameAction): ActionGatewayReceipt {
    const action = validateDecisionAction(expectation.boundary, input)
    const key = gatewayKey(expectation.matchId, expectation.actor.participantId)
    if (this.#actions.has(key)) throw new Error('This participant already submitted an action')
    expectation.onAccepted?.(action)
    this.#actions.set(key, action)
    return { accepted: true, actionId: `action-${randomBytes(8).toString('hex')}` }
  }
}

function gatewayKey(matchId: MatchId, participantId: ParticipantId): string {
  return `${MatchIdSchema.parse(matchId)}:${ParticipantIdSchema.parse(participantId)}`
}
