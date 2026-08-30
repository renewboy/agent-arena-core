import { Readable, Writable } from 'node:stream'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from '@agentclientprotocol/sdk'

const modelOption = (currentValue = 'mock-default') =>
  process.env.AGENT_ARENA_MOCK_MODEL_BOOLEAN === 'true'
    ? {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'boolean',
        currentValue: false,
      }
    : {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue,
        options:
          process.env.AGENT_ARENA_MOCK_NESTED_MODEL_OPTIONS === 'true'
            ? [
                {
                  group: 'Models',
                  name: 'Models',
                  options: [
                    { value: 'mock-default', name: 'Mock default' },
                    { value: 'mock-model', name: 'Mock model' },
                  ],
                },
              ]
            : [
                { value: 'mock-default', name: 'Mock default' },
                { value: 'mock-model', name: 'Mock model' },
              ],
      }

const reasoningValues = (model) => (model === 'mock-model' ? ['low', 'high'] : ['low', 'medium'])

const defaultReasoning = (model) => (model === 'mock-model' ? 'high' : 'medium')

const reasoningOption = (model, currentValue = defaultReasoning(model)) => ({
  id: 'reasoning_effort',
  name: 'Reasoning effort',
  category: 'thought_level',
  type: 'select',
  currentValue,
  options: reasoningValues(model).map((value) => ({ value, name: value })),
})

const storePath = resolve(process.cwd(), '.mock-agent-sessions.json')

function readStore() {
  try {
    return JSON.parse(readFileSync(storePath, 'utf8'))
  } catch {
    return {
      sessions: [],
      configs: {},
      configRequests: [],
      newCount: 0,
      resumeCount: 0,
      lastResumeMcpServers: [],
    }
  }
}

function writeStore(store) {
  writeFileSync(storePath, JSON.stringify(store))
}

function sessionResponse(config = { model: 'mock-default', reasoningEffort: 'medium' }) {
  const reasoning =
    process.env.AGENT_ARENA_MOCK_DISABLE_REASONING === 'true'
      ? []
      : [
          reasoningOption(config.model, config.reasoningEffort),
          ...(process.env.AGENT_ARENA_MOCK_DUPLICATE_REASONING === 'true'
            ? [reasoningOption(config.model, config.reasoningEffort)]
            : []),
        ]
  return {
    modes: {
      currentModeId: 'read-only',
      availableModes:
        process.env.AGENT_ARENA_MOCK_DISABLE_MODES === 'true'
          ? []
          : [{ id: 'read-only', name: 'Read only' }],
    },
    configOptions: [
      ...(process.env.AGENT_ARENA_MOCK_DISABLE_MODEL === 'true' ? [] : [modelOption(config.model)]),
      ...reasoning,
    ],
  }
}

let promptIndex = 0
const pendingPromptDelays = new Map()
const promptDelayMs = Math.max(
  0,
  Number.parseInt(process.env['AGENT_ARENA_MOCK_PROMPT_DELAY_MS'] ?? '0', 10) || 0,
)
const app = agent({ name: 'Agent Arena mock agent' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion:
      process.env.AGENT_ARENA_MOCK_PROTOCOL_MISMATCH === 'true'
        ? PROTOCOL_VERSION + 1
        : PROTOCOL_VERSION,
    agentCapabilities:
      process.env['AGENT_ARENA_MOCK_DISABLE_RESUME'] === 'true'
        ? {}
        : { loadSession: true, sessionCapabilities: { resume: {}, close: {} } },
    agentInfo: { name: 'agent-arena-mock', version: '1.0.0' },
  }))
  .onRequest(methods.agent.session.new, () => {
    const store = readStore()
    const sessionId = `mock-session-${store.sessions.length + 1}`
    store.sessions.push(sessionId)
    store.configs[sessionId] = { model: 'mock-default', reasoningEffort: 'medium' }
    store.newCount += 1
    writeStore(store)
    return {
      sessionId,
      ...sessionResponse(store.configs[sessionId]),
    }
  })
  .onRequest(methods.agent.session.resume, ({ params }) => {
    const store = readStore()
    if (!store.sessions.includes(params.sessionId)) throw new Error('Unknown session')
    store.resumeCount += 1
    store.lastResumeMcpServers = (params.mcpServers ?? []).map((server) => server.name)
    writeStore(store)
    return sessionResponse(
      process.env.AGENT_ARENA_MOCK_RESUME_DEFAULT_CONFIG === 'true'
        ? { model: 'mock-default', reasoningEffort: 'medium' }
        : store.configs[params.sessionId],
    )
  })
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    const store = readStore()
    const config = store.configs[params.sessionId]
    if (!config) throw new Error('Unknown session')
    const value = String(params.value)
    if (params.configId === 'model') {
      if (!['mock-default', 'mock-model'].includes(value)) throw new Error('Unknown model')
      config.model = value
      if (!reasoningValues(value).includes(config.reasoningEffort)) {
        config.reasoningEffort = defaultReasoning(value)
      }
    } else if (params.configId === 'reasoning_effort') {
      if (!reasoningValues(config.model).includes(value)) {
        throw new Error('Unsupported reasoning effort')
      }
      config.reasoningEffort = value
    } else {
      throw new Error('Unknown config option')
    }
    store.configRequests.push({
      sessionId: params.sessionId,
      configId: params.configId,
      value,
    })
    writeStore(store)
    return sessionResponse(config)
  })
  .onRequest(methods.agent.session.setMode, () => ({}))
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    if (!readStore().sessions.includes(params.sessionId)) throw new Error('Unknown session')
    if (promptDelayMs > 0) {
      const controller = new AbortController()
      pendingPromptDelays.set(params.sessionId, controller)
      await new Promise((resolvePromise) => {
        const timer = setTimeout(resolvePromise, promptDelayMs)
        controller.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolvePromise()
          },
          { once: true },
        )
      })
      pendingPromptDelays.delete(params.sessionId)
      if (controller.signal.aborted) return { stopReason: 'cancelled' }
    }
    const promptText = params.prompt
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('')
    promptIndex += 1
    const traceToolCallId = `mock-trace-${promptIndex}`
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_thought_chunk',
        messageId: `thought-${promptIndex}`,
        content: { type: 'text', text: '检查上下文' },
      },
    })
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: traceToolCallId,
        title: '读取局面摘要',
        kind: 'read',
        status: 'pending',
        rawInput: { promptCharacters: promptText.length },
      },
    })
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: traceToolCallId,
        status: 'completed',
        rawOutput: { checked: true },
      },
    })
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'usage_update',
        used: Math.min(promptText.length, 4096),
        size: 32768,
      },
    })
    if (promptText.includes('hang-after-tool')) {
      await new Promise(() => undefined)
    }
    if (promptText.includes('permission-check')) {
      const opaqueCodex = promptText.includes('permission-check-codex')
      const codebuddy = promptText.includes('permission-check-codebuddy')
      const permission = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'permission-tool',
          ...(opaqueCodex || codebuddy ? {} : { title: 'Approve 提交投票' }),
          ...(codebuddy ? {} : { kind: opaqueCodex ? 'execute' : 'other', status: 'pending' }),
          ...(codebuddy
            ? {
                rawInput: {
                  toolName: 'mcp__arena-actions__submit_vote',
                  params: { targetPlayerId: 'player-2' },
                },
              }
            : opaqueCodex
              ? {}
              : {
                  rawInput: {
                    server_name: 'arena-actions',
                    request: { _meta: { tool_title: '提交投票' } },
                  },
                }),
        },
        ...(opaqueCodex ? { _meta: { is_mcp_tool_approval: true } } : {}),
        options: [
          { kind: 'allow_once', name: 'Allow once', optionId: 'allow' },
          { kind: 'reject_once', name: 'Reject once', optionId: 'reject' },
        ],
      })
      const text =
        permission.outcome.outcome === 'selected'
          ? `permission-${permission.outcome.optionId}`
          : 'permission-cancelled'
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text },
        },
      })
      return { stopReason: 'end_turn' }
    }
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '你' },
      },
    })
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '好' },
      },
    })
    return { stopReason: 'end_turn' }
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    pendingPromptDelays.get(params.sessionId)?.abort()
  })
  .onRequest(methods.agent.session.close, async () => {
    if (process.env['AGENT_ARENA_MOCK_CLOSE_HANG'] === 'true') {
      await new Promise(() => undefined)
    }
    return {}
  })

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const connection = app.connect(stream)
await connection.closed
