import type { RequestPermissionRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import { MatchIdSchema } from '@agent-arena/contracts'
import { describe, expect, it, vi } from 'vitest'
import {
  TrajectoryRecordSchema,
  TrajectoryTurnRecorder,
  TrajectoryTurnSchema,
  type TrajectoryRecord,
  type TrajectoryTurn,
} from '../src/index.js'

describe('trajectory turn recorder', () => {
  it('merges streams, upserts tools, records usage, and redacts structured values', () => {
    const fixture = createFixture()
    const recorder = fixture.recorder
    recorder.prompt('Prompt text')
    for (const text of ['analysis', ' target', ' target']) {
      recorder.update({
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'reasoning-one',
        content: { type: 'text', text },
      } as SessionUpdate)
    }
    recorder.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'before tool' },
    } as SessionUpdate)
    recorder.update({ sessionUpdate: 'user_message_chunk' } as SessionUpdate)
    recorder.update({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'resource',
      content: { type: 'resource_link', name: 'resource', uri: 'memory://resource' },
    } as unknown as SessionUpdate)
    recorder.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-one',
      title: 'submit_action',
      status: 'pending',
      rawInput: {
        value: 'visible',
        authorization: 'Bearer hidden',
        nested: { apiKey: 'hidden' },
        _meta: { hidden: true },
      },
    } as unknown as SessionUpdate)
    recorder.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-one',
      status: 'completed',
      rawOutput: { accepted: true },
    } as unknown as SessionUpdate)
    recorder.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'after tool' },
    } as SessionUpdate)
    recorder.permission(permission('tool-one', { token: 'hidden' }), true)
    recorder.permission(permission('tool-two', { value: 'visible' }, false), false)
    for (const value of [
      'ERROR error diagnostic',
      'WARNING warning diagnostic',
      'DEBUG debug diagnostic',
      'ordinary diagnostic',
    ]) {
      recorder.diagnostic(value)
    }
    recorder.accepted('bigint', 1n)
    recorder.update({
      sessionUpdate: 'usage_update',
      used: 123,
      size: 4096,
      cost: { amount: 0.01, currency: 'USD' },
    } as SessionUpdate)
    recorder.action({ type: 'turn.pass' })
    recorder.complete('end_turn')

    expect(fixture.turn).toMatchObject({
      status: 'completed',
      stopReason: 'end_turn',
      usage: { used: 123, size: 4096 },
    })
    expect(fixture.records.filter((record) => record.kind === 'reasoning')).toHaveLength(1)
    expect(fixture.records.find((record) => record.kind === 'reasoning')?.text).toBe(
      'analysis target target',
    )
    expect(
      fixture.records.filter((record) => record.kind === 'message').map((record) => record.text),
    ).toEqual(['before tool', expect.stringContaining('resource_link'), 'after tool'])
    const tool = fixture.records.find((record) => record.kind === 'tool')!
    expect(tool).toMatchObject({ status: 'completed' })
    expect(tool.input).toContain('[REDACTED]')
    expect(tool.input).not.toContain('Bearer hidden')
    expect(tool.input).not.toContain('"hidden"')
    expect(tool.input).not.toContain('_meta')
    expect(tool.output).toContain('accepted')
    expect(fixture.records.filter((record) => record.kind === 'permission')).toHaveLength(2)
    expect(
      fixture.records
        .filter((record) => record.kind === 'diagnostic')
        .map((record) => record.status),
    ).toEqual(['error', 'warning', 'debug', 'info'])
    expect(fixture.records.some((record) => record.kind === 'action')).toBe(true)
  })

  it('bounds content, handles circular values, lifecycle updates, cancellation, and failures', () => {
    const fixture = createFixture()
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    fixture.recorder.accepted('x'.repeat(200), {
      circular,
      values: Array.from({ length: 220 }, (_, index) => index),
    })
    fixture.recorder.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'x'.repeat(140_000) },
    } as SessionUpdate)
    fixture.recorder.update({
      sessionUpdate: 'current_mode_update',
      currentModeId: 'read-only',
    } as unknown as SessionUpdate)
    fixture.recorder.diagnostic('x'.repeat(20_000))
    fixture.recorder.cancel()

    const action = fixture.records.find((record) => record.kind === 'action')!
    expect(action.title).toHaveLength(160)
    expect(action.input).toContain('[Circular]')
    const message = fixture.records.find((record) => record.kind === 'message')!
    expect(message.text).toHaveLength(131_072)
    expect(message.truncatedFields).toContain('text')
    const diagnostic = fixture.records.find((record) => record.kind === 'diagnostic')!
    expect(diagnostic.text).toHaveLength(16_384)
    expect(diagnostic.truncatedFields).toContain('text')
    expect(fixture.records.some((record) => record.kind === 'lifecycle')).toBe(true)
    expect(fixture.turn.status).toBe('cancelled')

    const failed = createFixture()
    failed.recorder.fail(new Error('transport failed'), 'uncertain')
    expect(failed.turn).toMatchObject({ status: 'uncertain', error: 'transport failed' })
    const nonError = createFixture()
    nonError.recorder.fail('plain failure', 'failed')
    expect(nonError.turn).toMatchObject({ status: 'failed', error: 'plain failure' })
  })

  it('accepts injected codecs and preserves pending tool timing', () => {
    const fixture = createFixture(true)
    fixture.recorder.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'pending',
      name: 'pending-tool',
      status: 'pending',
    } as unknown as SessionUpdate)
    fixture.recorder.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'pending',
      status: 'failed',
    } as unknown as SessionUpdate)
    fixture.recorder.complete('end_turn')
    expect(fixture.records[0]).toMatchObject({ status: 'failed', completedAt: expect.any(String) })
    expect(fixture.parseTurn).toHaveBeenCalled()
    expect(fixture.parseRecord).toHaveBeenCalled()
  })
})

function createFixture(injectedCodecs = false): {
  readonly recorder: TrajectoryTurnRecorder
  readonly records: TrajectoryRecord[]
  readonly parseTurn: ReturnType<typeof vi.fn>
  readonly parseRecord: ReturnType<typeof vi.fn>
  turn: TrajectoryTurn
} {
  const records: TrajectoryRecord[] = []
  let ordinal = 0
  const turn = TrajectoryTurnSchema.parse({
    matchId: MatchIdSchema.parse('match-trajectory'),
    turnId: 'turn-one',
    ownerId: 'participant-one',
    sessionId: 'session-one',
    sessionGeneration: 1,
    ordinal: 1,
    attempt: 1,
    kind: 'action',
    decisionId: 'decision-one',
    actionType: 'turn.choose',
    fromRevision: 1,
    toRevision: 2,
    visibleEventSequences: [2],
    runtimeStatus: 'running',
    continuation: false,
    status: 'running',
    startedAt: new Date(Date.now() - 10).toISOString(),
    completedAt: null,
    durationMs: null,
    stopReason: null,
    error: null,
    usage: null,
    revision: 0,
  })
  const result = {
    recorder: null as unknown as TrajectoryTurnRecorder,
    records,
    turn,
    parseTurn: vi.fn((value: unknown) => TrajectoryTurnSchema.parse(value)),
    parseRecord: vi.fn((value: unknown) => TrajectoryRecordSchema.parse(value)),
  }
  result.recorder = new TrajectoryTurnRecorder(
    {
      nextTrajectoryRecordOrdinal: () => ++ordinal,
    },
    turn,
    (nextTurn) => {
      result.turn = nextTurn
      return nextTurn
    },
    (record) => {
      const index = records.findIndex((candidate) => candidate.recordId === record.recordId)
      if (index < 0) records.push(record)
      else records[index] = record
      return record
    },
    ...(injectedCodecs ? [{ parseTurn: result.parseTurn, parseRecord: result.parseRecord }] : []),
  )
  return result
}

function permission(
  toolCallId: string,
  rawInput: unknown,
  titled = true,
): RequestPermissionRequest {
  return {
    sessionId: 'session-one',
    toolCall: {
      toolCallId,
      ...(titled ? { title: 'permission' } : { name: 'permission' }),
      rawInput,
    },
    options: [{ optionId: 'allow', kind: 'allow_once', name: 'Allow once' }],
  } as unknown as RequestPermissionRequest
}
