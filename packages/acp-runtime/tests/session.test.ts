import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { AcpSession } from '../src/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('AcpSession', () => {
  it('keeps one session and streams message chunks through a real stdio connection', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      model: 'mock-model',
      mode: 'read-only',
    })
    const chunks: string[] = []
    const result = await session.prompt('开始', 5_000, {
      onTextChunk: (chunk) => chunks.push(chunk),
    })

    expect(session.sessionId).toBe('mock-session-1')
    expect(session.initializeResponse.agentInfo?.name).toBe('agent-arena-mock')
    expect(chunks).toEqual(['你', '好'])
    expect(result.text).toBe('你好')
    expect(result.stopReason).toBe('end_turn')
    await session.close()
  })

  it('ends an active Prompt after an accepted tool receipt without waiting for later text', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-accepted-action-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
    })
    let receiptCompleted = false
    const startedAt = Date.now()
    const result = await session.prompt('hang-after-tool', 5_000, {
      onUpdate: (update) => {
        if (
          receiptCompleted ||
          update.sessionUpdate !== 'tool_call_update' ||
          update.status !== 'completed'
        ) {
          return
        }
        receiptCompleted = true
        session.finishAfterAcceptedAction()
      },
    })

    expect(receiptCompleted).toBe(true)
    expect(result.text).toBe('')
    expect(result.stopReason).toBe('end_turn')
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    await session.close()
  })

  it('forwards prompts larger than the guardian stdin FIFO capacity', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-large-prompt-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
    })

    const result = await session.prompt('x'.repeat(32 * 1024), 5_000)

    expect(result.text).toBe('你好')
    expect(result.stopReason).toBe('end_turn')
    await session.close()
  })

  it('reapplies model and reasoning when resume reports process defaults', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-reasoning-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const launch = {
      command: process.execPath,
      args: [fixture],
      env: { ...process.env, AGENT_ARENA_MOCK_RESUME_DEFAULT_CONFIG: 'true' },
    }
    const created = await AcpSession.start({
      cwd,
      launch,
      model: 'mock-model',
      reasoningEffort: 'low',
      requireSessionResume: true,
    })
    expect(
      created.configOptions.find((option) => option.category === 'thought_level'),
    ).toMatchObject({ currentValue: 'low', options: expect.any(Array) })
    const sessionId = created.sessionId
    await created.close()

    const store = JSON.parse(await readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8')) as {
      configRequests: Array<{ configId: string; value: string }>
    }
    expect(store.configRequests).toEqual([
      { sessionId, configId: 'model', value: 'mock-model' },
      { sessionId, configId: 'reasoning_effort', value: 'low' },
    ])

    const resumed = await AcpSession.start({
      cwd,
      launch,
      model: 'mock-model',
      reasoningEffort: 'low',
      resumeSessionId: sessionId,
      requireSessionResume: true,
    })
    await resumed.close()

    const resumedStore = JSON.parse(
      await readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8'),
    ) as {
      configRequests: Array<{ configId: string; value: string }>
    }
    expect(resumedStore.configRequests).toEqual([
      { sessionId, configId: 'model', value: 'mock-model' },
      { sessionId, configId: 'reasoning_effort', value: 'low' },
      { sessionId, configId: 'model', value: 'mock-model' },
      { sessionId, configId: 'reasoning_effort', value: 'low' },
    ])

    await expect(
      AcpSession.start({
        cwd,
        launch,
        model: 'mock-model',
        reasoningEffort: 'medium',
      }),
    ).rejects.toThrow(/does not advertise reasoning effort medium/)
  }, 15_000)

  it('leaves reasoning at the Agent default when thought_level is not advertised', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-default-reasoning-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ...process.env, AGENT_ARENA_MOCK_DISABLE_REASONING: 'true' },
      },
      model: 'mock-model',
    })
    expect(session.configOptions.some((option) => option.category === 'thought_level')).toBe(false)
    await session.close()
  })

  it('resumes one durable Session ID in a new ACP process without session/new', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-resume-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const launch = { command: process.execPath, args: [fixture], env: { ...process.env } }
    const created = await AcpSession.start({
      cwd,
      launch,
      model: 'mock-model',
      requireSessionResume: true,
    })
    const sessionId = created.sessionId
    expect((await created.prompt('开始', 5_000)).text).toBe('你好')
    await created.close()

    const resumed = await AcpSession.start({
      cwd,
      launch,
      resumeSessionId: sessionId,
      requireSessionResume: true,
      mcpServers: [
        {
          type: 'http',
          name: 'arena-actions',
          url: 'http://127.0.0.1:4310/mcp',
          headers: [],
        },
      ],
    })
    expect(resumed.sessionId).toBe(sessionId)
    expect((await resumed.prompt('继续当前阶段', 5_000)).text).toBe('你好')
    await resumed.close()

    const store = JSON.parse(await readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8')) as {
      newCount: number
      resumeCount: number
      lastResumeMcpServers: string[]
    }
    expect(store).toMatchObject({
      newCount: 1,
      resumeCount: 1,
      lastResumeMcpServers: ['arena-actions'],
    })
  }, 15_000)

  it('verifies and uses a provider-specific unadvertised session/resume implementation', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-unadvertised-resume-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const launch = {
      command: process.execPath,
      args: [fixture],
      env: { ...process.env, AGENT_ARENA_MOCK_DISABLE_RESUME: 'true' },
    }
    const created = await AcpSession.start({
      cwd,
      launch,
      requireSessionResume: true,
      verifyUnadvertisedSessionResume: true,
    })
    const sessionId = created.sessionId
    await created.close()

    const afterCreate = JSON.parse(
      await readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8'),
    ) as { newCount: number; resumeCount: number }
    expect(afterCreate).toMatchObject({ newCount: 1, resumeCount: 1 })

    const resumed = await AcpSession.start({
      cwd,
      launch,
      resumeSessionId: sessionId,
      requireSessionResume: true,
      verifyUnadvertisedSessionResume: true,
    })
    expect(resumed.sessionId).toBe(sessionId)
    await resumed.close()

    const afterResume = JSON.parse(
      await readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8'),
    ) as { newCount: number; resumeCount: number }
    expect(afterResume).toMatchObject({ newCount: 1, resumeCount: 2 })
  })

  it('fails before session/new when a Match player Agent cannot resume Sessions', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-no-resume-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    await expect(
      AcpSession.start({
        cwd,
        launch: {
          command: process.execPath,
          args: [fixture],
          env: { ...process.env, AGENT_ARENA_MOCK_DISABLE_RESUME: 'true' },
        },
        requireSessionResume: true,
      }),
    ).rejects.toThrow('Unable to start ACP session')
    await expect(readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8')).rejects.toThrow()
  })

  it('does not create a Session when the persisted resume ID is unknown', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-unknown-resume-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    await expect(
      AcpSession.start({
        cwd,
        launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
        resumeSessionId: 'mock-session-missing',
        requireSessionResume: true,
      }),
    ).rejects.toThrow('Unable to start ACP session')
    await expect(readFile(resolve(cwd, '.mock-agent-sessions.json'), 'utf8')).rejects.toThrow()
  })

  it('approves only explicitly whitelisted Agent Arena action tools', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-permission-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      model: 'mock-model',
      approvedMcpTools: [{ server: 'arena-actions', tool: 'submit_vote', title: '提交投票' }],
    })
    expect((await session.prompt('permission-check', 5_000)).text).toBe('permission-allow')
    expect((await session.prompt('permission-check-codebuddy', 5_000)).text).toBe(
      'permission-allow',
    )
    expect((await session.prompt('permission-check-codex', 5_000)).text).toBe(
      'permission-cancelled',
    )
    await session.close()

    const codex = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      model: 'mock-model',
      approvedMcpTools: [{ server: 'arena-actions', tool: 'submit_vote', title: '提交投票' }],
      allowOpaqueMcpPermissions: true,
    })
    expect((await codex.prompt('permission-check-codex', 5_000)).text).toBe('permission-allow')
    await codex.close()

    const denied = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      model: 'mock-model',
    })
    expect((await denied.prompt('permission-check', 5_000)).text).toBe('permission-cancelled')
    expect((await denied.prompt('permission-check-codebuddy', 5_000)).text).toBe(
      'permission-cancelled',
    )
    expect((await denied.prompt('permission-check-codex', 5_000)).text).toBe('permission-cancelled')
    await denied.close()
  }, 15_000)

  it('bounds a protocol close that never settles', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-hung-close-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ...process.env, AGENT_ARENA_MOCK_CLOSE_HANG: 'true' },
      },
    })

    const startedAt = Date.now()
    await session.close()
    expect(Date.now() - startedAt).toBeLessThan(3_000)
  }, 5_000)

  it('rejects protocol/config/mode contracts that cannot honor requested Session settings', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    for (const [environment, options, expected] of [
      [{ AGENT_ARENA_MOCK_PROTOCOL_MISMATCH: 'true' }, {}, 'protocol mismatch'],
      [{ AGENT_ARENA_MOCK_DISABLE_MODEL: 'true' }, { model: 'mock-model' }, 'model configuration'],
      [{ AGENT_ARENA_MOCK_MODEL_BOOLEAN: 'true' }, { model: 'mock-model' }, 'not selectable'],
      [
        { AGENT_ARENA_MOCK_DUPLICATE_REASONING: 'true' },
        { reasoningEffort: 'low' },
        'multiple thought_level',
      ],
      [
        { AGENT_ARENA_MOCK_DISABLE_REASONING: 'true' },
        { reasoningEffort: 'low' },
        'thought_level configuration',
      ],
      [
        { AGENT_ARENA_MOCK_DISABLE_MODES: 'true' },
        { mode: 'read-only' },
        'does not advertise mode',
      ],
    ] as const) {
      const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-invalid-config-'))
      temporaryDirectories.push(cwd)
      await expect(
        AcpSession.start({
          cwd,
          launch: {
            command: process.execPath,
            args: [fixture],
            env: { ...process.env, ...environment },
          },
          ...options,
        }),
      ).rejects.toThrow(expected)
    }
  }, 20_000)

  it('accepts grouped model options and exposes mode/stderr/connected lifecycle getters', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-grouped-options-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const stderr: string[] = []
    const session = await AcpSession.start({
      cwd,
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ...process.env, AGENT_ARENA_MOCK_NESTED_MODEL_OPTIONS: 'true' },
      },
      model: 'mock-model',
      modelConfigKey: 'missing-but-category-falls-back',
      onStderr: (chunk) => stderr.push(chunk),
      sessionMeta: { test: true },
    })
    expect(session.connected).toBe(true)
    expect(session.availableModes).toEqual([{ id: 'read-only', name: 'Read only' }])
    expect(session.stderrTail).toBe('')
    expect(stderr).toEqual([])
    await session.close()
    await session.close()
    expect(session.connected).toBe(false)
    session.finishAfterAcceptedAction()
    await expect(session.prompt('closed', 10)).rejects.toThrow(/session is closed/)
  })

  it('rejects concurrent Prompts and reports a confirmed timeout as reusable uncertainty', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-timeout-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ...process.env, AGENT_ARENA_MOCK_PROMPT_DELAY_MS: '80' },
      },
    })
    const first = session.prompt('first', 1_000)
    await expect(session.prompt('second', 1_000)).rejects.toThrow(/already has an active Prompt/)
    await expect(first).resolves.toMatchObject({ text: '你好' })
    await expect(session.prompt('timeout', 1)).rejects.toMatchObject({
      name: 'AcpDeliveryUncertainError',
      sessionReusable: true,
    })
    session.finishAfterAcceptedAction()
    await session.close()
  })

  it('supersedes an active Prompt through ACP cancellation without closing the Session', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-supersede-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const session = await AcpSession.start({
      cwd,
      launch: {
        command: process.execPath,
        args: [fixture],
        env: { ...process.env, AGENT_ARENA_MOCK_PROMPT_DELAY_MS: '500' },
      },
    })
    const prompt = session.prompt('superseded', 5_000)

    await expect(session.cancelActivePrompt()).resolves.toBe(true)
    await expect(prompt).resolves.toMatchObject({ stopReason: 'cancelled' })
    expect(session.connected).toBe(true)
    await expect(session.prompt('next', 5_000)).resolves.toMatchObject({ stopReason: 'end_turn' })
    await session.close()
  })

  it('reports permission callbacks for allowed and denied MCP requests', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'agent-arena-acp-permission-callbacks-'))
    temporaryDirectories.push(cwd)
    const fixture = fileURLToPath(new URL('./fixtures/mock-agent.mjs', import.meta.url))
    const requests: unknown[] = []
    const decisions: boolean[] = []
    const allowed = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      approvedMcpTools: [{ server: 'arena-actions', tool: 'submit_vote', title: '提交投票' }],
      onPermissionRequest: (request) => requests.push(request),
      onPermissionDecision: (_request, decision) => decisions.push(decision),
    })
    expect((await allowed.prompt('permission-check', 5_000)).text).toBe('permission-allow')
    await allowed.close()
    const denied = await AcpSession.start({
      cwd,
      launch: { command: process.execPath, args: [fixture], env: { ...process.env } },
      onPermissionRequest: (request) => requests.push(request),
      onPermissionDecision: (_request, decision) => decisions.push(decision),
    })
    expect((await denied.prompt('permission-check', 5_000)).text).toBe('permission-cancelled')
    await denied.close()
    expect(requests).toHaveLength(2)
    expect(decisions).toEqual([true, false])
  })
})
