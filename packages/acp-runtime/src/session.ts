import { Readable, Writable } from 'node:stream'
import {
  PROTOCOL_VERSION,
  client,
  methods,
  ndJsonStream,
  type ClientConnection,
  type ClientContext,
  type InitializeResponse,
  type McpServer,
  type RequestPermissionRequest,
  type SessionConfigOption,
  type SessionMode,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk'
import { AcpDeliveryUncertainError, AcpLifecycleError } from './errors.js'
import { AgentProcess } from './process.js'
import type { ProcessLaunchSpec } from './launch.js'

const sessionCloseTimeoutMs = 1_000

export interface AcpSessionStartOptions {
  readonly cwd: string
  readonly launch: ProcessLaunchSpec
  readonly model?: string
  readonly modelConfigKey?: string
  readonly reasoningEffort?: string
  readonly mode?: string
  readonly mcpServers?: readonly McpServer[]
  readonly sessionMeta?: Readonly<Record<string, unknown>>
  readonly approvedToolNames?: readonly string[]
  readonly approvedMcpTools?: readonly {
    readonly server: string
    readonly tool: string
    readonly title?: string
  }[]
  readonly allowOpaqueMcpPermissions?: boolean
  readonly onPermissionRequest?: (request: RequestPermissionRequest) => void
  readonly onPermissionDecision?: (request: RequestPermissionRequest, allowed: boolean) => void
  readonly onStderr?: (chunk: string) => void
  readonly resumeSessionId?: string
  readonly requireSessionResume?: boolean
  readonly verifyUnadvertisedSessionResume?: boolean
}

export interface AcpPromptCallbacks {
  readonly onTextChunk?: (chunk: string) => void
  readonly onUpdate?: (update: SessionUpdate) => void
}

export interface AcpPromptResult {
  readonly text: string
  readonly stopReason: StopReason
  readonly updates: readonly SessionUpdate[]
}

interface ActivePromptState {
  readonly callbacks: AcpPromptCallbacks
  readonly controller: AbortController
  readonly updates: SessionUpdate[]
  finishAfterAcceptedAction: boolean
  text: string
}

export class AcpSession {
  readonly #process: AgentProcess
  readonly #connection: ClientConnection
  readonly #context: ClientContext
  readonly #sessionId: string
  readonly #initializeResponse: InitializeResponse
  readonly #availableModes: readonly SessionMode[]
  readonly #configOptions: readonly SessionConfigOption[]
  #activePrompt: ActivePromptState | null = null
  #closed = false

  private constructor(
    process: AgentProcess,
    connection: ClientConnection,
    context: ClientContext,
    sessionId: string,
    initializeResponse: InitializeResponse,
    availableModes: readonly SessionMode[],
    configOptions: readonly SessionConfigOption[],
  ) {
    this.#process = process
    this.#connection = connection
    this.#context = context
    this.#sessionId = sessionId
    this.#initializeResponse = initializeResponse
    this.#availableModes = availableModes
    this.#configOptions = configOptions
  }

  public static async start(options: AcpSessionStartOptions): Promise<AcpSession> {
    const process = new AgentProcess({
      cwd: options.cwd,
      launch: options.launch,
      ...(options.onStderr ? { onStderr: options.onStderr } : {}),
    })
    try {
      let activeSession: AcpSession | null = null
      const app = client({ name: 'Agent Arena' })
        .onRequest(methods.client.session.requestPermission, ({ params }) =>
          permissionDecision(params, options),
        )
        .onNotification(methods.client.session.update, ({ params }) => {
          if (activeSession) activeSession.#handleUpdate(params.sessionId, params.update)
        })
      const stream = ndJsonStream(
        Writable.toWeb(process.child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(process.child.stdout) as ReadableStream<Uint8Array>,
      )
      const connection = app.connect(stream)
      const context = connection.agent
      const initialized = await context.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: 'agent-arena-core', version: '0.1.0' },
      })
      if (initialized.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `ACP protocol mismatch: expected ${PROTOCOL_VERSION}, received ${initialized.protocolVersion}`,
        )
      }
      const supportsResume =
        initialized.agentCapabilities?.sessionCapabilities?.resume !== undefined
      const canVerifyUnadvertisedResume = options.verifyUnadvertisedSessionResume === true
      if (
        (options.requireSessionResume || options.resumeSessionId) &&
        !supportsResume &&
        !canVerifyUnadvertisedResume
      ) {
        throw new Error('ACP agent does not advertise session.resume')
      }

      const request = {
        cwd: options.cwd,
        mcpServers: [...(options.mcpServers ?? [])],
      }
      let sessionId: string
      let availableModes: readonly SessionMode[]
      let configOptions: readonly SessionConfigOption[]
      if (options.resumeSessionId) {
        const response = await context.request(methods.agent.session.resume, {
          sessionId: options.resumeSessionId,
          ...request,
        })
        sessionId = options.resumeSessionId
        availableModes = response.modes?.availableModes ?? []
        configOptions = await configureSession(context, sessionId, response, options)
      } else {
        const created = await context.request(methods.agent.session.new, {
          ...request,
          ...(options.sessionMeta ? { _meta: { ...options.sessionMeta } } : {}),
        })
        sessionId = created.sessionId
        const response =
          options.requireSessionResume && !supportsResume && canVerifyUnadvertisedResume
            ? await context.request(methods.agent.session.resume, {
                sessionId,
                ...request,
              })
            : created
        availableModes = response.modes?.availableModes ?? []
        configOptions = await configureSession(context, sessionId, response, options)
      }

      activeSession = new AcpSession(
        process,
        connection,
        context,
        sessionId,
        initialized,
        availableModes,
        configOptions,
      )
      return activeSession
    } catch (error) {
      await process.close()
      const detail = error instanceof Error ? error.message : String(error)
      throw new AcpLifecycleError(`Unable to start ACP session: ${detail}`, process.stderrTail, {
        cause: error,
      })
    }
  }

  public get sessionId(): string {
    return this.#sessionId
  }

  public get initializeResponse(): InitializeResponse {
    return this.#initializeResponse
  }

  public get stderrTail(): string {
    return this.#process.stderrTail
  }

  public get availableModes(): readonly SessionMode[] {
    return this.#availableModes
  }

  public get configOptions(): readonly SessionConfigOption[] {
    return this.#configOptions
  }

  public get connected(): boolean {
    return !this.#closed && !this.#connection.signal.aborted
  }

  public finishAfterAcceptedAction(): void {
    const activePrompt = this.#activePrompt
    if (!activePrompt || activePrompt.controller.signal.aborted) return
    activePrompt.finishAfterAcceptedAction = true
    activePrompt.controller.abort(new Error('ACP Prompt completed after accepted action'))
  }

  public async cancelActivePrompt(): Promise<boolean> {
    if (!this.#activePrompt) return false
    await this.#context.notify(methods.agent.session.cancel, { sessionId: this.#sessionId })
    return true
  }

  public async prompt(
    prompt: string,
    timeoutMs: number,
    callbacks: AcpPromptCallbacks = {},
  ): Promise<AcpPromptResult> {
    if (this.#closed) throw new AcpLifecycleError('ACP session is closed', this.stderrTail)
    if (this.#activePrompt) throw new AcpLifecycleError('ACP Session already has an active Prompt')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('ACP prompt timed out')), timeoutMs)
    timer.unref()
    const activePrompt: ActivePromptState = {
      callbacks,
      controller,
      updates: [],
      finishAfterAcceptedAction: false,
      text: '',
    }
    this.#activePrompt = activePrompt
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(controller.signal.reason)
      if (controller.signal.aborted) onAbort()
      else controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      const promptRequest = this.#context.request(
        methods.agent.session.prompt,
        {
          sessionId: this.#sessionId,
          prompt: [{ type: 'text', text: prompt }],
        },
        { cancellationSignal: controller.signal },
      )
      void promptRequest.catch(() => undefined)
      const response = await Promise.race([promptRequest, timeoutFailure])
      return {
        text: activePrompt.text,
        stopReason: response.stopReason,
        updates: activePrompt.updates,
      }
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error)
      try {
        await this.#context.notify(methods.agent.session.cancel, {
          sessionId: this.#sessionId,
        })
      } catch (cancelError) {
        throw new AcpDeliveryUncertainError(
          `ACP prompt failed: ${failure}; cancellation was not confirmed`,
          {
            cause: new AggregateError([error, cancelError]),
            sessionReusable: false,
          },
        )
      }
      if (activePrompt.finishAfterAcceptedAction) {
        return {
          text: activePrompt.text,
          stopReason: 'end_turn',
          updates: activePrompt.updates,
        }
      }
      throw new AcpDeliveryUncertainError(`ACP prompt failed: ${failure}`, {
        cause: error,
        sessionReusable: this.connected,
      })
    } finally {
      clearTimeout(timer)
      if (this.#activePrompt === activePrompt) this.#activePrompt = null
    }
  }

  public async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      await withTimeout(
        this.#context.request(methods.agent.session.close, {
          sessionId: this.#sessionId,
        }),
        sessionCloseTimeoutMs,
        'ACP session close timed out',
      )
    } catch (error) {
      if (!this.#connection.signal.aborted) this.#connection.close(error)
    } finally {
      this.#connection.close()
      await this.#process.close()
    }
  }

  #handleUpdate(sessionId: string, update: SessionUpdate): void {
    if (sessionId !== this.#sessionId || !this.#activePrompt) return
    this.#activePrompt.updates.push(update)
    this.#activePrompt.callbacks.onUpdate?.(update)
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      this.#activePrompt.text += update.content.text
      this.#activePrompt.callbacks.onTextChunk?.(update.content.text)
    }
  }
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  message: string,
): Promise<Value> {
  let timer: NodeJS.Timeout | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    timer.unref()
  })
  void promise.catch(() => undefined)
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function permissionDecision(request: RequestPermissionRequest, options: AcpSessionStartOptions) {
  options.onPermissionRequest?.(request)
  const name = request.toolCall.name ?? ''
  const nameAllowed = (options.approvedToolNames ?? []).some(
    (allowed) =>
      name === allowed ||
      ['__', ':', '/', '.'].some((separator) => name.endsWith(`${separator}${allowed}`)),
  )
  const rawInput = request.toolCall.rawInput
  const mcpAllowed = (options.approvedMcpTools ?? []).some(
    (approved) =>
      (isRecord(rawInput) &&
        rawInput['server'] === approved.server &&
        rawInput['tool'] === approved.tool) ||
      (isRecord(rawInput) &&
        typeof rawInput['toolName'] === 'string' &&
        canonicalMcpToolName(rawInput['toolName']) ===
          canonicalMcpToolName(`mcp__${approved.server}__${approved.tool}`)) ||
      (isRecord(rawInput) &&
        rawInput['server_name'] === approved.server &&
        isRecord(rawInput['request']) &&
        isRecord(rawInput['request']['_meta']) &&
        rawInput['request']['_meta']['tool_title'] === approved.title),
  )
  const requestMetadata = request['_meta']
  const opaqueCodexMcpAllowed =
    options.allowOpaqueMcpPermissions === true &&
    (options.approvedMcpTools?.length ?? 0) > 0 &&
    request.toolCall.kind === 'execute' &&
    isRecord(requestMetadata) &&
    requestMetadata['is_mcp_tool_approval'] === true
  const selection = request.options.find((option) => option.kind === 'allow_once')
  const allowed = Boolean((nameAllowed || mcpAllowed || opaqueCodexMcpAllowed) && selection)
  options.onPermissionDecision?.(request, allowed)
  return allowed && selection
    ? { outcome: { outcome: 'selected' as const, optionId: selection.optionId } }
    : { outcome: { outcome: 'cancelled' as const } }
}

function canonicalMcpToolName(value: string): string {
  return value.toLowerCase().replaceAll(/[-.]/g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function configureSession(
  context: ClientContext,
  sessionId: string,
  session: {
    readonly modes?: { readonly availableModes: readonly SessionMode[] } | null
    readonly configOptions?: readonly SessionConfigOption[] | null
  },
  options: AcpSessionStartOptions,
): Promise<readonly SessionConfigOption[]> {
  let configOptions = session.configOptions ?? []
  if (options.model) {
    const modelConfigKey = options.modelConfigKey ?? 'model'
    const modelOption = configOptions.find(
      (option) => option.id === modelConfigKey || option.category === 'model',
    )
    if (!modelOption) {
      throw new Error('ACP agent does not advertise a model configuration option')
    }
    configOptions = await setSelectConfigOption(
      context,
      sessionId,
      modelOption,
      options.model,
      'model',
    )
  }

  if (options.reasoningEffort) {
    const reasoningOption = reasoningConfigOption(configOptions)
    if (!reasoningOption) {
      throw new Error('ACP agent does not advertise a thought_level configuration option')
    }
    configOptions = await setSelectConfigOption(
      context,
      sessionId,
      reasoningOption,
      options.reasoningEffort,
      'reasoning effort',
    )
  }

  if (options.mode) {
    const available = session.modes?.availableModes.some((mode) => mode.id === options.mode)
    if (!available) throw new Error(`ACP agent does not advertise mode ${options.mode}`)
    await context.request(methods.agent.session.setMode, {
      sessionId,
      modeId: options.mode,
    })
  }
  return configOptions
}

function reasoningConfigOption(
  configOptions: readonly SessionConfigOption[],
): SessionConfigOption | undefined {
  const matching = configOptions.filter((option) => option.category === 'thought_level')
  if (matching.length > 1) {
    throw new Error('ACP agent advertises multiple thought_level configuration options')
  }
  return matching[0]
}

async function setSelectConfigOption(
  context: ClientContext,
  sessionId: string,
  option: SessionConfigOption,
  value: string,
  label: string,
): Promise<readonly SessionConfigOption[]> {
  if (option.type !== 'select') {
    throw new Error(`ACP ${label} configuration option is not selectable`)
  }
  const values = selectOptionValues(option)
  if (!values.includes(value)) {
    throw new Error(`ACP agent does not advertise ${label} ${value}`)
  }
  const response = await context.request(methods.agent.session.setConfigOption, {
    sessionId,
    configId: option.id,
    value,
  })
  return response.configOptions
}

function selectOptionValues(option: Extract<SessionConfigOption, { type: 'select' }>): string[] {
  return option.options.flatMap((entry) =>
    'options' in entry ? entry.options.map(({ value }) => value) : [entry.value],
  )
}
