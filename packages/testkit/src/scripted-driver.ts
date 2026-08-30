import type { JsonValue, ParticipantId } from '@agent-arena/contracts'
import type { ParticipantTurnContext, ParticipantTurnDriver } from '@agent-arena/match-runtime'

export type ScriptedDecision =
  | {
      readonly kind: 'tool'
      readonly toolName: string
      readonly payload: JsonValue
      readonly delayMs?: number
    }
  | { readonly kind: 'text'; readonly text: string; readonly delayMs?: number }
  | { readonly kind: 'failure'; readonly message: string; readonly delayMs?: number }

export class ScriptedParticipantDriver<Facts> implements ParticipantTurnDriver<Facts> {
  readonly #scripts: Map<ParticipantId, ScriptedDecision[]>
  readonly completionOrder: ParticipantId[] = []

  public constructor(scripts: ReadonlyMap<ParticipantId, readonly ScriptedDecision[]>) {
    this.#scripts = new Map(
      [...scripts].map(([participantId, decisions]) => [participantId, [...decisions]]),
    )
  }

  public async takeTurn(context: ParticipantTurnContext<Facts>): Promise<void> {
    const decisions = this.#scripts.get(context.participantId)
    const decision = decisions?.shift()
    if (!decision) throw new Error(`No scripted decision for ${context.participantId}`)
    if (decision.delayMs) await delay(decision.delayMs)
    if (decision.kind === 'failure') throw new Error(decision.message)
    if (decision.kind === 'text') context.gateway.submitText(context.token, decision.text)
    else context.gateway.submitTool(context.token, decision.toolName, decision.payload)
    this.completionOrder.push(context.participantId)
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}
