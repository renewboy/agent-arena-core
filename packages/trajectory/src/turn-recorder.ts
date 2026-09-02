import type { RequestPermissionRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import {
  TrajectoryRecordSchema,
  TrajectoryTurnSchema,
  type TrajectoryRecord,
  type TrajectoryRecordBase,
  type TrajectoryRecordKind,
  type TrajectoryTurn,
  type TrajectoryTurnBase,
  type TrajectoryTurnStatus,
  type TrajectoryUsage,
} from './contracts.js'

const contentLimit = 131_072
const diagnosticLimit = 16_384
const secretKey =
  /authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key/i

export interface TrajectoryRecordStore<MatchId extends string, OwnerId extends string> {
  nextTrajectoryRecordOrdinal(matchId: MatchId, ownerId: OwnerId): number
}

export interface TrajectoryCodecs<
  Turn extends TrajectoryTurnBase,
  RecordValue extends TrajectoryRecordBase,
> {
  parseTurn(value: unknown): Turn
  parseRecord(value: unknown): RecordValue
}

export class TrajectoryTurnRecorder<
  Turn extends TrajectoryTurnBase = TrajectoryTurn,
  RecordValue extends TrajectoryRecordBase = TrajectoryRecord,
> {
  readonly #repository: TrajectoryRecordStore<Turn['matchId'], Turn['ownerId']>
  readonly #saveTurn: (turn: Turn) => Turn
  readonly #saveRecord: (record: RecordValue) => RecordValue
  readonly #codecs: TrajectoryCodecs<Turn, RecordValue>
  readonly #streams = new Map<string, RecordValue>()
  readonly #tools = new Map<string, RecordValue>()
  #turn: Turn
  #step = 1
  #streamGeneration = 1
  #lastKind: TrajectoryRecordKind | null = null

  public constructor(
    repository: TrajectoryRecordStore<Turn['matchId'], Turn['ownerId']>,
    turn: Turn,
    saveTurn: (turn: Turn) => Turn,
    saveRecord: (record: RecordValue) => RecordValue,
    codecs: TrajectoryCodecs<Turn, RecordValue> = defaultCodecs() as unknown as TrajectoryCodecs<
      Turn,
      RecordValue
    >,
  ) {
    this.#repository = repository
    this.#turn = turn
    this.#saveTurn = saveTurn
    this.#saveRecord = saveRecord
    this.#codecs = codecs
  }

  public instructions(instructions: string): void {
    this.#createRecord('instructions', 'instructions', { text: instructions })
  }

  public prompt(prompt: string): void {
    this.#createRecord('prompt', 'prompt', { text: prompt })
  }

  public update(update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const kind = update.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'message'
        const channel = kind === 'reasoning' ? 'reasoning' : 'message'
        const key = `${channel}:${update.messageId ?? 'default'}`
        const content =
          update.content.type === 'text' ? update.content.text : safeJson(update.content).value
        this.#mergeStream(key, kind, content)
        return
      }
      case 'user_message_chunk':
        return
      case 'tool_call':
      case 'tool_call_update': {
        const callId = update.toolCallId
        const current = this.#tools.get(callId)
        if (!current) this.#streamGeneration += 1
        const rawInput = 'rawInput' in update ? update.rawInput : undefined
        const rawOutput = 'rawOutput' in update ? update.rawOutput : undefined
        const input = rawInput === undefined ? undefined : safeJson(rawInput)
        const output = rawOutput === undefined ? undefined : safeJson(rawOutput)
        const status = update.status ?? current?.status ?? null
        const record = current
          ? this.#saveRecord(
              this.#codecs.parseRecord({
                ...current,
                title: update.title ?? update.name ?? current.title,
                status,
                input: input?.value ?? current.input,
                output: output?.value ?? current.output,
                truncatedFields: unique([
                  ...current.truncatedFields,
                  ...(input?.truncated ? ['input' as const] : []),
                  ...(output?.truncated ? ['output' as const] : []),
                ]),
                completedAt: terminalToolStatus(status) ? new Date().toISOString() : null,
                durationMs: terminalToolStatus(status)
                  ? elapsed(current.startedAt, new Date().toISOString())
                  : null,
              }),
            )
          : this.#createRecord('tool', update.title ?? update.name ?? 'tool', {
              status,
              ...(input ? { input } : {}),
              ...(output ? { output } : {}),
              recordId: `${this.#turn.turnId}:tool:${callId}`,
            })
        this.#tools.set(callId, record)
        this.#lastKind = 'tool'
        return
      }
      case 'usage_update': {
        const usage: TrajectoryUsage = {
          used: update.used,
          size: update.size,
          cost: update.cost ?? null,
        }
        this.#turn = this.#saveTurn(this.#codecs.parseTurn({ ...this.#turn, usage }))
        this.#createRecord('usage', 'usage', { usage, status: 'updated' })
        return
      }
      default:
        this.#createRecord('lifecycle', update.sessionUpdate, {
          text: safeJson(update).value,
          status: update.sessionUpdate,
        })
    }
  }

  public permission(request: RequestPermissionRequest, allowed: boolean): void {
    const input = safeJson(request.toolCall.rawInput)
    this.#createRecord(
      'permission',
      request.toolCall.title ?? request.toolCall.name ?? 'permission',
      {
        status: allowed ? 'allowed' : 'denied',
        input,
        recordId: `${this.#turn.turnId}:permission:${request.toolCall.toolCallId}`,
      },
    )
  }

  public diagnostic(value: string): void {
    const text = truncate(value, diagnosticLimit)
    this.#createRecord('diagnostic', 'diagnostic', {
      text: text.value,
      truncatedText: text.truncated,
      status: diagnosticSeverity(value),
    })
  }

  public action(action: { readonly type: string }): void {
    this.accepted(action.type, action)
  }

  public accepted(title: string, value: unknown): void {
    const input = safeJson(value)
    this.#createRecord('action', title, { input, status: 'accepted' })
  }

  public complete(stopReason: string): void {
    this.#finish('completed', stopReason, null)
  }

  public cancel(stopReason = 'cancelled'): void {
    this.#finish('cancelled', stopReason, null)
  }

  public fail(error: unknown, status: Extract<TrajectoryTurnStatus, 'failed' | 'uncertain'>): void {
    const message = truncate(
      error instanceof Error ? error.message : String(error),
      diagnosticLimit,
    )
    this.#createRecord('error', 'error', {
      text: message.value,
      truncatedText: message.truncated,
      status,
    })
    this.#finish(status, null, message.value)
  }

  #finish(status: TrajectoryTurnStatus, stopReason: string | null, error: string | null): void {
    const completedAt = new Date().toISOString()
    this.#turn = this.#saveTurn(
      this.#codecs.parseTurn({
        ...this.#turn,
        status,
        completedAt,
        durationMs: elapsed(this.#turn.startedAt, completedAt),
        stopReason,
        error,
      }),
    )
  }

  #mergeStream(key: string, kind: 'reasoning' | 'message', incoming: string): void {
    if (this.#lastKind === 'tool') this.#step += 1
    const stepKey = `${this.#streamGeneration}:${key}`
    const current = this.#streams.get(stepKey)
    const text = current ? mergeText(current.text ?? '', incoming) : incoming
    const bounded = truncate(text, contentLimit)
    const record = current
      ? this.#saveRecord(
          this.#codecs.parseRecord({
            ...current,
            text: bounded.value,
            truncatedFields: bounded.truncated
              ? unique([...current.truncatedFields, 'text'])
              : current.truncatedFields,
          }),
        )
      : this.#createRecord(kind, kind, {
          text: bounded.value,
          truncatedText: bounded.truncated,
          recordId: `${this.#turn.turnId}:${kind}:${stepKey}`,
        })
    this.#streams.set(stepKey, record)
    this.#lastKind = kind
  }

  #createRecord(
    kind: TrajectoryRecordKind,
    title: string,
    values: {
      readonly text?: string
      readonly input?: SanitizedValue
      readonly output?: SanitizedValue
      readonly usage?: TrajectoryUsage
      readonly status?: string | null
      readonly recordId?: string
      readonly truncatedText?: boolean
    },
  ): RecordValue {
    const startedAt = new Date().toISOString()
    const ordinal = this.#repository.nextTrajectoryRecordOrdinal(
      this.#turn.matchId,
      this.#turn.ownerId,
    )
    const record = this.#codecs.parseRecord({
      matchId: this.#turn.matchId,
      recordId: values.recordId ?? `${this.#turn.turnId}:record:${ordinal}`,
      turnId: this.#turn.turnId,
      ownerId: this.#turn.ownerId,
      ordinal,
      step: this.#step,
      kind,
      title: truncate(title, 160).value || kind,
      status: values.status ?? null,
      text: values.text ?? null,
      input: values.input?.value ?? null,
      output: values.output?.value ?? null,
      usage: values.usage ?? null,
      startedAt,
      completedAt: kind === 'tool' && !terminalToolStatus(values.status ?? null) ? null : startedAt,
      durationMs: kind === 'tool' && !terminalToolStatus(values.status ?? null) ? null : 0,
      truncatedFields: [
        ...(values.truncatedText ? ['text' as const] : []),
        ...(values.input?.truncated ? ['input' as const] : []),
        ...(values.output?.truncated ? ['output' as const] : []),
      ],
      revision: 0,
    })
    this.#lastKind = kind
    return this.#saveRecord(record)
  }
}

export interface SanitizedValue {
  readonly value: string
  readonly truncated: boolean
}

export function serializeTrajectoryValue(value: unknown): SanitizedValue {
  return safeJson(value)
}

export function trajectoryElapsed(start: string, end: string): number {
  return elapsed(start, end)
}

function safeJson(value: unknown): SanitizedValue {
  let serialized: string
  try {
    serialized = JSON.stringify(sanitize(value, new WeakSet()), null, 2) ?? String(value)
  } catch {
    serialized = String(value)
  }
  return truncate(serialized, contentLimit)
}

function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitize(entry, seen))
  if (typeof value !== 'object' || value === null) return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value).slice(0, 200)) {
    if (key === '_meta') continue
    output[key] = secretKey.test(key) ? '[REDACTED]' : sanitize(entry, seen)
  }
  return output
}

function truncate(value: string, limit: number): SanitizedValue {
  if (value.length <= limit) return { value, truncated: false }
  return { value: value.slice(0, limit), truncated: true }
}

function mergeText(current: string, incoming: string): string {
  return `${current}${incoming}`
}

function terminalToolStatus(status: string | null): boolean {
  return status === 'completed' || status === 'failed'
}

function diagnosticSeverity(value: string): string {
  if (/\bERROR\b/.test(value)) return 'error'
  if (/\bWARN(?:ING)?\b/.test(value)) return 'warning'
  if (/\bDEBUG\b/.test(value)) return 'debug'
  return 'info'
}

function elapsed(start: string, end: string): number {
  return Math.max(0, Date.parse(end) - Date.parse(start))
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)]
}

function defaultCodecs(): TrajectoryCodecs<TrajectoryTurn, TrajectoryRecord> {
  return {
    parseTurn: (value) => TrajectoryTurnSchema.parse(value),
    parseRecord: (value) => TrajectoryRecordSchema.parse(value),
  }
}
