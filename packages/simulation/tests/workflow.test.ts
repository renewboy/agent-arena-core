import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  GameIdSchema,
  MatchIdSchema,
  RulesetIdSchema,
  SemanticIdSchema,
  SimulationIdSchema,
} from '@agent-arena/contracts'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SimulationCaptureSchema,
  SimulationFixtureSchema,
  SimulationRunReportSchema,
  addSimulationCandidate,
  approveSimulationCandidate,
  classifySimulationFault,
  firstSimulationDifference,
  normalizeSimulationValue,
  readSimulationCandidate,
  reviewSimulationCandidate,
  reviewedSimulationExpected,
  scanSimulationSecrets,
  simulationFingerprint,
  simulationSeed,
  type SimulationCapture,
  type SimulationExpected,
  type SimulationRunner,
  type SimulationWorkflowConfig,
} from '../src/index.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  )
})

describe('simulation workflow', () => {
  it('adds, reviews, approves, and reuses immutable candidates and fixtures', async () => {
    const root = await temporaryRoot()
    const capture = candidate()
    const config = workflow(root, [runner('runner-engine'), runner('runner-orchestration')])

    await expect(addSimulationCandidate(config, capture)).resolves.toMatchObject({ created: true })
    await expect(addSimulationCandidate(config, capture)).resolves.toMatchObject({ created: false })
    await expect(readSimulationCandidate(config, capture.simulationId)).resolves.toEqual(capture)
    await expect(reviewSimulationCandidate(config, capture.simulationId)).resolves.toMatchObject({
      runnersAgree: true,
      canApprove: true,
      canAcceptCurrent: true,
      runners: [
        { runnerId: 'runner-engine', deterministic: true, ok: true },
        { runnerId: 'runner-orchestration', deterministic: true, ok: true },
      ],
    })
    const approved = await approveSimulationCandidate(config, capture.simulationId, {
      acceptCurrent: false,
      acknowledgeWarnings: false,
    })
    expect(approved).toMatchObject({ created: true, variants: ['recorded', 'restart-boundary'] })
    await expect(
      approveSimulationCandidate(config, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).resolves.toMatchObject({ created: false })

    const fixture = SimulationFixtureSchema.parse(
      JSON.parse(
        await readFile(resolve(root, 'fixtures', `${capture.simulationId}.sim.json`), 'utf8'),
      ),
    )
    expect(fixture.expected).toEqual(reviewedSimulationExpected(capture.observed))
  })

  it('requires warning acknowledgement and rejects sensitive candidates first', async () => {
    const root = await temporaryRoot()
    const capture = candidate({ warnings: ['manual review'] })
    const config = workflow(root, [runner('runner-one'), runner('runner-two')])
    await addSimulationCandidate(config, capture)
    await expect(
      approveSimulationCandidate(config, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow(/warnings require acknowledgement/)
    await expect(
      approveSimulationCandidate(
        { ...config, scanSecrets: () => ['credential'] },
        capture.simulationId,
        { acceptCurrent: false, acknowledgeWarnings: true },
      ),
    ).rejects.toThrow(/sensitive content/)
    await expect(
      approveSimulationCandidate(config, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: true,
      }),
    ).resolves.toMatchObject({ created: true })
  })

  it('accepts an agreed runner result explicitly and rejects disagreement or nondeterminism', async () => {
    const root = await temporaryRoot()
    const capture = candidate()
    const current = expected(2)
    const agreed = workflow(root, [
      runner('runner-one', { actual: current, ok: false }),
      runner('runner-two', { actual: current, ok: false }),
    ])
    await addSimulationCandidate(agreed, capture)
    await expect(reviewSimulationCandidate(agreed, capture.simulationId)).resolves.toMatchObject({
      canApprove: false,
      canAcceptCurrent: true,
    })
    await expect(
      approveSimulationCandidate(agreed, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow(/differs from the runner result/)
    await expect(
      approveSimulationCandidate(agreed, capture.simulationId, {
        acceptCurrent: true,
        acknowledgeWarnings: false,
      }),
    ).resolves.toMatchObject({ created: true })

    const disagreement = workflow(root, [
      runner('runner-one', { actual: expected(2) }),
      runner('runner-two', { actual: expected(3) }),
    ])
    await expect(
      reviewSimulationCandidate(disagreement, capture.simulationId),
    ).resolves.toMatchObject({
      runnersAgree: false,
      canAcceptCurrent: false,
    })
    await expect(
      approveSimulationCandidate(disagreement, capture.simulationId, {
        acceptCurrent: true,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow(/Runner results cannot be accepted/)

    const nondeterministic = workflow(root, [
      runner('runner-one', { alternating: [expected(2), expected(3)] }),
      runner('runner-two', { actual: expected(2) }),
    ])
    await expect(
      reviewSimulationCandidate(nondeterministic, capture.simulationId),
    ).resolves.toMatchObject({
      canAcceptCurrent: false,
      runners: [{ deterministic: false }, { deterministic: true }],
    })
  })

  it('rejects mismatched reports, insufficient runners, empty variants, and immutable conflicts', async () => {
    const root = await temporaryRoot()
    const capture = candidate()
    const oneRunner = workflow(root, [runner('runner-one')])
    await addSimulationCandidate(oneRunner, capture)
    await expect(reviewSimulationCandidate(oneRunner, capture.simulationId)).rejects.toThrow(
      /at least two independent runners/,
    )

    const mismatched = workflow(root, [
      runner('runner-one', { reportRunnerId: 'runner-other' }),
      runner('runner-two'),
    ])
    await expect(reviewSimulationCandidate(mismatched, capture.simulationId)).rejects.toThrow(
      /mismatched report/,
    )

    const noVariants = {
      ...workflow(root, [runner('runner-one'), runner('runner-two')]),
      variants: () => [],
    }
    await expect(
      approveSimulationCandidate(noVariants, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow(/requires variants/)

    await expect(
      addSimulationCandidate(oneRunner, candidate({ fingerprint: 'b'.repeat(64) })),
    ).rejects.toThrow(/other source data/)

    const valid = workflow(root, [runner('runner-one'), runner('runner-two')])
    await approveSimulationCandidate(valid, capture.simulationId, {
      acceptCurrent: false,
      acknowledgeWarnings: false,
    })
    const fixturePath = resolve(root, 'fixtures', `${capture.simulationId}.sim.json`)
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>
    await writeFile(
      fixturePath,
      JSON.stringify({
        ...fixture,
        source: { ...(fixture['source'] as object), fingerprint: 'c'.repeat(64) },
      }),
    )
    await expect(
      approveSimulationCandidate(valid, capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toThrow(/contains other data/)
  })
})

describe('simulation canonical helpers', () => {
  it('classifies faults, secrets, normalization, differences, digests, and seeds', () => {
    expect(classifySimulationFault('uncertain', null)).toBe('uncertain-delivery')
    expect(classifySimulationFault('cancelled', null)).toBe('cancelled')
    expect(classifySimulationFault('failed', 'Prompt timed out')).toBe('timeout')
    expect(classifySimulationFault('failed', 'process exited')).toBe('process-exit')
    expect(classifySimulationFault('failed', 'invalid action')).toBe('invalid-action')
    expect(classifySimulationFault('failed', 'unknown')).toBe('other')
    expect(
      scanSimulationSecrets({
        authorization: 'Bearer abcdefghijklmnop',
        key: 'sk-proj-abcdefghijklmnop',
        pem: '-----BEGIN PRIVATE KEY-----',
        path: '/Users/example/project',
      }),
    ).toEqual(['authorization-header', 'api-key', 'private-key', 'absolute-user-path'])
    expect(
      normalizeSimulationValue(
        { name: 'Original', nested: ['Original', 1] },
        new Map([['Original', 'Canonical']]),
      ),
    ).toEqual({ name: 'Canonical', nested: ['Canonical', 1] })
    expect(firstSimulationDifference({ a: [1] }, { a: [1] })).toBeNull()
    expect(firstSimulationDifference([1], [1, 2])).toContain('length')
    expect(firstSimulationDifference({ a: 1 }, { a: 2 })).toContain('result.a')
    expect(simulationFingerprint({ stable: true })).toMatch(/^[a-f0-9]{64}$/)
    expect(simulationSeed('simulation-workflow-valid', 'recorded')).toHaveLength(16)
  })
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'agent-arena-simulation-'))
  temporaryDirectories.push(root)
  return root
}

function workflow(root: string, runners: readonly SimulationRunner[]): SimulationWorkflowConfig {
  return {
    projectRoot: root,
    candidateDirectory: resolve(root, 'candidates'),
    fixtureDirectory: resolve(root, 'fixtures'),
    runners,
    variants: () => [
      SemanticIdSchema.parse('recorded'),
      SemanticIdSchema.parse('restart-boundary'),
    ],
  }
}

function candidate(
  options: { readonly warnings?: readonly string[]; readonly fingerprint?: string } = {},
): SimulationCapture {
  const observed = expected(1)
  return SimulationCaptureSchema.parse({
    schemaVersion: 1,
    stage: 'candidate',
    simulationId: SimulationIdSchema.parse('simulation-workflow-valid'),
    title: 'Workflow conformance',
    gameId: GameIdSchema.parse('game-conformance'),
    ruleset: {
      id: RulesetIdSchema.parse('ruleset-conformance'),
      revision: 1,
      plugins: [],
      fingerprint: 'a'.repeat(64),
    },
    matchId: MatchIdSchema.parse('match-conformance'),
    source: {
      status: 'ended',
      cutoffSequence: 1,
      capturedAt: '2026-01-01T00:00:00.000Z',
      fingerprint: options.fingerprint ?? 'a'.repeat(64),
    },
    setup: { participants: ['participant-one', 'participant-two'] },
    turns: [],
    controls: [],
    observed,
    warnings: options.warnings ?? [],
  })
}

function expected(value: number): SimulationExpected {
  return {
    events: [
      {
        matchId: MatchIdSchema.parse('match-conformance'),
        sequence: 1,
        occurredAt: '2026-01-01T00:00:00.000Z',
        eventType: SemanticIdSchema.parse('score.changed'),
        schemaVersion: 1,
        audience: { kind: 'public' },
        payload: { value },
      },
    ],
    checkpoint: { status: 'ended', value },
  }
}

function runner(
  idValue: string,
  options: {
    readonly actual?: SimulationExpected
    readonly ok?: boolean
    readonly alternating?: readonly [SimulationExpected, SimulationExpected]
    readonly reportRunnerId?: string
  } = {},
): SimulationRunner {
  const id = SemanticIdSchema.parse(idValue)
  let runCount = 0
  return {
    id,
    run: async (input, variant) => {
      const actual =
        options.alternating?.[runCount++ % 2] ??
        options.actual ??
        (input.stage === 'candidate' ? input.observed : expected(1))
      return SimulationRunReportSchema.parse({
        simulationId: input.simulationId,
        runnerId: SemanticIdSchema.parse(options.reportRunnerId ?? id),
        variant,
        seed: simulationSeed(input.simulationId, variant),
        ok: options.ok ?? true,
        failures: options.ok === false ? ['semantic difference'] : [],
        actual,
      })
    },
  }
}
