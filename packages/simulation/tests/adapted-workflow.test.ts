import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  AdaptedSimulationWorkflow,
  AdaptedSimulationWorkflowError,
  type AdaptedSimulationRunner,
  type SimulationArtifactAdapter,
} from '../src/index.js'

const ExpectedSchema = z.object({ value: z.number().int() }).strict()
const CaptureSchema = z
  .object({
    stage: z.literal('candidate'),
    simulationId: z.string(),
    status: z.enum(['paused', 'ended']),
    fingerprint: z.string(),
    warnings: z.array(z.string()),
    turns: z.number().int().nonnegative(),
    observed: ExpectedSchema,
  })
  .strict()
const FixtureSchema = z
  .object({
    stage: z.literal('approved'),
    simulationId: z.string(),
    fingerprint: z.string(),
    expected: ExpectedSchema,
    variants: z.array(z.string()),
  })
  .strict()
type Capture = z.infer<typeof CaptureSchema>
type Fixture = z.infer<typeof FixtureSchema>
type Expected = z.infer<typeof ExpectedSchema>

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('adapted simulation workflow', () => {
  it('adds, normalizes, reviews, approves, and reuses game-owned artifacts', async () => {
    const root = await temporaryRoot()
    const capture = candidate()
    const workflow = createWorkflow(root, [runner('engine'), runner('orchestration')])
    await expect(workflow.addCandidate(capture)).resolves.toMatchObject({ created: true })
    await expect(workflow.addCandidate(capture)).resolves.toMatchObject({ created: false })
    await expect(workflow.readCandidate(capture.simulationId)).resolves.toEqual(capture)
    await expect(workflow.reviewCandidate(capture.simulationId)).resolves.toMatchObject({
      runnersAgree: true,
      canApprove: true,
      canAcceptCurrent: true,
      runners: [
        { runnerId: 'engine', deterministic: true, ok: true },
        { runnerId: 'orchestration', deterministic: true, ok: true },
      ],
    })
    const approved = await workflow.approveCandidate(capture.simulationId, {
      acceptCurrent: false,
      acknowledgeWarnings: false,
    })
    expect(approved).toMatchObject({ created: true, variants: ['recorded', 'restart'] })
    await expect(
      workflow.approveCandidate(capture.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).resolves.toMatchObject({ created: false })
    expect(
      FixtureSchema.parse(
        JSON.parse(
          await readFile(resolve(root, 'fixtures', `${capture.simulationId}.sim.json`), 'utf8'),
        ),
      ).expected,
    ).toEqual(capture.observed)
  })

  it('enforces warnings, secret scanning, accepted current behavior, and runner agreement', async () => {
    const root = await temporaryRoot()
    const warning = candidate({ warnings: ['manual'] })
    const warningWorkflow = createWorkflow(root, [runner('one'), runner('two')])
    await warningWorkflow.addCandidate(warning)
    await expect(
      warningWorkflow.approveCandidate(warning.simulationId, {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toMatchObject({ code: 'warning-acknowledgement' })

    const secretRoot = await temporaryRoot()
    const secretWorkflow = createWorkflow(secretRoot, [runner('one'), runner('two')], {
      scanSecrets: () => ['credential'],
    })
    await secretWorkflow.addCandidate(candidate())
    await expect(
      secretWorkflow.approveCandidate('simulation-adapted', {
        acceptCurrent: true,
        acknowledgeWarnings: true,
      }),
    ).rejects.toMatchObject({ code: 'sensitive-content' })

    const currentRoot = await temporaryRoot()
    const currentWorkflow = createWorkflow(currentRoot, [
      runner('one', { actual: { value: 2 }, ok: false }),
      runner('two', { actual: { value: 2 }, ok: false }),
    ])
    await currentWorkflow.addCandidate(candidate())
    await expect(
      currentWorkflow.approveCandidate('simulation-adapted', {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toMatchObject({ code: 'observed-mismatch' })
    await expect(
      currentWorkflow.approveCandidate('simulation-adapted', {
        acceptCurrent: true,
        acknowledgeWarnings: false,
      }),
    ).resolves.toMatchObject({ created: true })

    const disagreement = createWorkflow(currentRoot, [
      runner('one', { actual: { value: 2 } }),
      runner('two', { actual: { value: 3 } }),
    ])
    await expect(
      disagreement.approveCandidate('simulation-adapted', {
        acceptCurrent: true,
        acknowledgeWarnings: false,
      }),
    ).rejects.toMatchObject({ code: 'runner-rejection' })
  })

  it('rejects nondeterminism, report mismatches, empty variants, ID conflicts, and immutable conflicts', async () => {
    const root = await temporaryRoot()
    const alternating = runner('one', { alternating: [{ value: 1 }, { value: 2 }] })
    const workflow = createWorkflow(root, [alternating, runner('two')])
    await workflow.addCandidate(candidate())
    await expect(workflow.reviewCandidate('simulation-adapted')).resolves.toMatchObject({
      canAcceptCurrent: false,
      runners: [{ deterministic: false }, { deterministic: true }],
    })

    const mismatch = createWorkflow(root, [
      runner('one', { reportRunnerId: 'other' }),
      runner('two'),
    ])
    await expect(mismatch.reviewCandidate('simulation-adapted')).rejects.toMatchObject({
      code: 'runner-report-mismatch',
    })
    expect(() => createWorkflow(root, [runner('one')])).toThrowError(AdaptedSimulationWorkflowError)

    const emptyRoot = await temporaryRoot()
    const empty = createWorkflow(emptyRoot, [runner('one'), runner('two')], {
      variants: () => [],
    })
    await empty.addCandidate(candidate())
    await expect(
      empty.approveCandidate('simulation-adapted', {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toMatchObject({ code: 'empty-variants' })

    await expect(workflow.addCandidate(candidate({ fingerprint: 'other' }))).rejects.toMatchObject({
      code: 'candidate-conflict',
    })

    const idPath = resolve(root, 'candidates', 'requested.sim.json')
    await writeFile(idPath, `${JSON.stringify(candidate())}\n`)
    await expect(workflow.reviewCandidate('requested')).rejects.toMatchObject({
      code: 'candidate-id-mismatch',
    })

    const approvedRoot = await temporaryRoot()
    const approved = createWorkflow(approvedRoot, [runner('one'), runner('two')])
    await approved.addCandidate(candidate())
    await approved.approveCandidate('simulation-adapted', {
      acceptCurrent: false,
      acknowledgeWarnings: false,
    })
    const path = resolve(approvedRoot, 'fixtures', 'simulation-adapted.sim.json')
    const fixture = FixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    await writeFile(path, `${JSON.stringify({ ...fixture, fingerprint: 'other' })}\n`)
    await expect(
      approved.approveCandidate('simulation-adapted', {
        acceptCurrent: false,
        acknowledgeWarnings: false,
      }),
    ).rejects.toMatchObject({ code: 'fixture-source-conflict' })
  })
})

function createWorkflow(
  root: string,
  runners: readonly AdaptedSimulationRunner<Capture | Fixture, Expected, string>[],
  overrides: Partial<SimulationArtifactAdapter<Capture, Fixture, Expected, Expected, string>> = {},
) {
  const baseAdapter: SimulationArtifactAdapter<Capture, Fixture, Expected, Expected, string> = {
    parseCapture: (input) => CaptureSchema.parse(input),
    parseFixture: (input) => FixtureSchema.parse(input),
    normalizeCapture: (capture) => CaptureSchema.parse(capture),
    describeCapture: (capture) => ({
      simulationId: capture.simulationId,
      sourceStatus: capture.status,
      sourceFingerprint: capture.fingerprint,
      warnings: capture.warnings,
      turnCount: capture.turns,
      eventCount: 1,
      observed: capture.observed,
    }),
    reviewedExpected: (expected) => ExpectedSchema.parse(expected),
    variants: () => ['recorded', 'restart'],
    buildFixture: (capture, accepted, variants) =>
      FixtureSchema.parse({
        stage: 'approved',
        simulationId: capture.simulationId,
        fingerprint: capture.fingerprint,
        expected: accepted,
        variants,
      }),
    describeFixture: (fixture) => ({
      sourceFingerprint: fixture.fingerprint,
      expected: fixture.expected,
      variants: fixture.variants,
    }),
    scanSecrets: () => [],
    sameExpected: (left, right) => left.value === right.value,
    ...overrides,
  }
  return new AdaptedSimulationWorkflow({
    projectRoot: root,
    candidateDirectory: resolve(root, 'candidates'),
    fixtureDirectory: resolve(root, 'fixtures'),
    reviewVariant: 'recorded',
    adapter: baseAdapter,
    runners,
  })
}

function candidate(options: { warnings?: string[]; fingerprint?: string } = {}): Capture {
  return {
    stage: 'candidate',
    simulationId: 'simulation-adapted',
    status: 'ended',
    fingerprint: options.fingerprint ?? 'fingerprint',
    warnings: options.warnings ?? [],
    turns: 2,
    observed: { value: 1 },
  }
}

function runner(
  id: string,
  options: {
    actual?: Expected
    ok?: boolean
    alternating?: readonly [Expected, Expected]
    reportRunnerId?: string
  } = {},
): AdaptedSimulationRunner<Capture | Fixture, Expected, string> {
  let index = 0
  return {
    id,
    run: async (input, variant) => {
      const actual =
        options.alternating?.[index++ % 2] ??
        options.actual ??
        (input.stage === 'candidate' ? input.observed : input.expected)
      return {
        simulationId: input.simulationId,
        runnerId: options.reportRunnerId ?? id,
        variant,
        ok: options.ok ?? true,
        failures: options.ok === false ? ['semantic difference'] : [],
        actual,
      }
    },
  }
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'arena-adapted-simulation-'))
  roots.push(root)
  return root
}
