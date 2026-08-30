import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

export interface SimulationCaptureDescription<Expected> {
  readonly simulationId: string
  readonly sourceStatus: 'paused' | 'ended'
  readonly sourceFingerprint: string
  readonly warnings: readonly string[]
  readonly turnCount: number
  readonly eventCount: number
  readonly observed: Expected
}

export interface SimulationFixtureDescription<Reviewed, Variant extends string> {
  readonly sourceFingerprint: string
  readonly expected: Reviewed
  readonly variants: readonly Variant[]
}

export interface SimulationArtifactAdapter<
  Capture,
  Fixture,
  Expected,
  Reviewed,
  Variant extends string,
> {
  parseCapture(input: unknown): Capture
  parseFixture(input: unknown): Fixture
  normalizeCapture?(capture: Capture): Capture
  describeCapture(capture: Capture): SimulationCaptureDescription<Expected>
  reviewedExpected(expected: Expected): Reviewed
  variants(capture: Capture): readonly Variant[]
  buildFixture(capture: Capture, accepted: Expected, variants: readonly Variant[]): Fixture
  describeFixture(fixture: Fixture): SimulationFixtureDescription<Reviewed, Variant>
  scanSecrets?(capture: Capture): readonly string[]
  sameExpected?(left: Expected, right: Expected): boolean
}

export interface AdaptedSimulationRunReport<Expected, Variant extends string> {
  readonly simulationId: string
  readonly runnerId: string
  readonly variant: Variant
  readonly ok: boolean
  readonly failures: readonly string[]
  readonly actual: Expected
}

export interface AdaptedSimulationRunner<Input, Expected, Variant extends string> {
  readonly id: string
  run(input: Input, variant: Variant): Promise<AdaptedSimulationRunReport<Expected, Variant>>
}

export interface AdaptedSimulationWorkflowConfig<
  Capture,
  Fixture,
  Expected,
  Reviewed,
  Variant extends string,
> {
  readonly projectRoot: string
  readonly candidateDirectory: string
  readonly fixtureDirectory: string
  readonly reviewVariant: Variant
  readonly adapter: SimulationArtifactAdapter<Capture, Fixture, Expected, Reviewed, Variant>
  readonly runners: readonly AdaptedSimulationRunner<Capture | Fixture, Expected, Variant>[]
}

export interface AdaptedSimulationReviewResult {
  readonly simulationId: string
  readonly relativePath: string
  readonly sourceStatus: 'paused' | 'ended'
  readonly turns: number
  readonly events: number
  readonly runners: readonly {
    readonly runnerId: string
    readonly deterministic: boolean
    readonly ok: boolean
    readonly failures: readonly string[]
  }[]
  readonly runnersAgree: boolean
  readonly canApprove: boolean
  readonly canAcceptCurrent: boolean
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
  readonly secretWarnings: readonly string[]
}

export interface AdaptedSimulationApprovalOptions {
  readonly acceptCurrent: boolean
  readonly acknowledgeWarnings: boolean
}

export class AdaptedSimulationWorkflow<
  Capture,
  Fixture,
  Expected,
  Reviewed,
  Variant extends string,
> {
  readonly #config: AdaptedSimulationWorkflowConfig<Capture, Fixture, Expected, Reviewed, Variant>

  public constructor(
    config: AdaptedSimulationWorkflowConfig<Capture, Fixture, Expected, Reviewed, Variant>,
  ) {
    if (config.runners.length < 2) {
      throw new AdaptedSimulationWorkflowError(
        'insufficient-runners',
        'Review requires at least two independent runners',
      )
    }
    this.#config = config
  }

  public async addCandidate(input: Capture) {
    const capture = this.#config.adapter.parseCapture(input)
    const description = this.#config.adapter.describeCapture(capture)
    await mkdir(this.#config.candidateDirectory, { recursive: true })
    const path = this.#candidatePath(description.simulationId)
    let created = true
    try {
      await writeFile(path, `${JSON.stringify(capture, null, 2)}\n`, { flag: 'wx' })
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = await this.readCandidate(description.simulationId)
      if (
        this.#config.adapter.describeCapture(existing).sourceFingerprint !==
        description.sourceFingerprint
      ) {
        throw new AdaptedSimulationWorkflowError(
          'candidate-conflict',
          'A candidate with this ID contains other source data',
        )
      }
      created = false
    }
    return {
      simulationId: description.simulationId,
      relativePath: relative(this.#config.projectRoot, path),
      created,
      warnings: [...description.warnings],
    }
  }

  public async readCandidate(id: string): Promise<Capture> {
    const capture = this.#config.adapter.parseCapture(
      JSON.parse(await readFile(this.#candidatePath(id), 'utf8')),
    )
    return this.#config.adapter.normalizeCapture?.(capture) ?? capture
  }

  public async reviewCandidate(id: string): Promise<AdaptedSimulationReviewResult> {
    return (await this.#review(id)).result
  }

  public async approveCandidate(id: string, options: AdaptedSimulationApprovalOptions) {
    const review = await this.#review(id)
    if (review.result.secretWarnings.length > 0) {
      throw new AdaptedSimulationWorkflowError(
        'sensitive-content',
        `Capture contains sensitive content: ${review.result.secretWarnings.join(', ')}`,
      )
    }
    if (review.result.warnings.length > 0 && !options.acknowledgeWarnings) {
      throw new AdaptedSimulationWorkflowError(
        'warning-acknowledgement',
        'Capture warnings require acknowledgement',
      )
    }
    if (!review.result.canApprove && !options.acceptCurrent) {
      throw new AdaptedSimulationWorkflowError(
        'observed-mismatch',
        'Captured behavior differs from the runner result',
      )
    }
    if (options.acceptCurrent && !review.result.canAcceptCurrent) {
      throw new AdaptedSimulationWorkflowError(
        'runner-rejection',
        'Runner results cannot be accepted',
      )
    }
    const variants = [...this.#config.adapter.variants(review.capture)]
    if (variants.length === 0) {
      throw new AdaptedSimulationWorkflowError('empty-variants', 'Approval requires variants')
    }
    const accepted = options.acceptCurrent
      ? review.runners[0]!.first.actual
      : this.#config.adapter.describeCapture(review.capture).observed
    const fixture = this.#config.adapter.parseFixture(
      this.#config.adapter.buildFixture(review.capture, accepted, variants),
    )
    await mkdir(this.#config.fixtureDirectory, { recursive: true })
    const path = resolve(this.#config.fixtureDirectory, `${id}.sim.json`)
    let created = true
    let approvedVariants = variants
    try {
      await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, { flag: 'wx' })
    } catch (error) {
      if (!isAlreadyExists(error)) throw error
      const existing = this.#config.adapter.parseFixture(JSON.parse(await readFile(path, 'utf8')))
      const expected = this.#config.adapter.describeFixture(fixture)
      const actual = this.#config.adapter.describeFixture(existing)
      if (actual.sourceFingerprint !== expected.sourceFingerprint) {
        throw new AdaptedSimulationWorkflowError(
          'fixture-source-conflict',
          'An approved fixture with this ID contains other data',
        )
      }
      if (JSON.stringify(actual.expected) !== JSON.stringify(expected.expected)) {
        throw new AdaptedSimulationWorkflowError(
          'fixture-oracle-conflict',
          'The approved fixture contains another reviewed result',
        )
      }
      approvedVariants = [...actual.variants]
      created = false
    }
    return {
      simulationId: id,
      relativePath: relative(this.#config.projectRoot, path),
      created,
      variants: approvedVariants,
    }
  }

  async #review(id: string) {
    const capture = await this.readCandidate(id)
    const description = this.#config.adapter.describeCapture(capture)
    if (description.simulationId !== id) {
      throw new AdaptedSimulationWorkflowError(
        'candidate-id-mismatch',
        `Candidate ${description.simulationId} does not match ${id}`,
      )
    }
    const runners = await Promise.all(
      this.#config.runners.map(async (runner) => {
        const first = await runner.run(capture, this.#config.reviewVariant)
        const second = await runner.run(capture, this.#config.reviewVariant)
        this.#validateReport(first, runner.id, id)
        this.#validateReport(second, runner.id, id)
        return { first, second, deterministic: this.#same(first.actual, second.actual) }
      }),
    )
    const runnersAgree = runners
      .slice(1)
      .every((runner) => this.#same(runners[0]!.first.actual, runner.first.actual))
    const secretWarnings = [...(this.#config.adapter.scanSecrets?.(capture) ?? [])]
    const canAcceptCurrent =
      runners.every((runner) => runner.deterministic) && runnersAgree && secretWarnings.length === 0
    const result: AdaptedSimulationReviewResult = {
      simulationId: id,
      relativePath: relative(this.#config.projectRoot, this.#candidatePath(id)),
      sourceStatus: description.sourceStatus,
      turns: description.turnCount,
      events: description.eventCount,
      runners: runners.map((runner) => ({
        runnerId: runner.first.runnerId,
        deterministic: runner.deterministic,
        ok: runner.first.ok,
        failures: [...runner.first.failures],
      })),
      runnersAgree,
      canApprove: canAcceptCurrent && runners.every((runner) => runner.first.ok),
      canAcceptCurrent,
      failures: [...new Set(runners.flatMap((runner) => runner.first.failures))],
      warnings: [...description.warnings],
      secretWarnings,
    }
    return { capture, runners, result }
  }

  #validateReport(
    report: AdaptedSimulationRunReport<Expected, Variant>,
    runnerId: string,
    simulationId: string,
  ): void {
    if (
      report.runnerId !== runnerId ||
      report.simulationId !== simulationId ||
      report.variant !== this.#config.reviewVariant
    ) {
      throw new AdaptedSimulationWorkflowError(
        'runner-report-mismatch',
        `Runner ${runnerId} returned a mismatched report`,
      )
    }
  }

  #same(left: Expected, right: Expected): boolean {
    return (
      this.#config.adapter.sameExpected?.(left, right) ??
      JSON.stringify(left) === JSON.stringify(right)
    )
  }

  #candidatePath(id: string): string {
    return resolve(this.#config.candidateDirectory, `${id}.sim.json`)
  }
}

export type AdaptedSimulationWorkflowErrorCode =
  | 'insufficient-runners'
  | 'candidate-conflict'
  | 'sensitive-content'
  | 'warning-acknowledgement'
  | 'observed-mismatch'
  | 'runner-rejection'
  | 'empty-variants'
  | 'fixture-source-conflict'
  | 'fixture-oracle-conflict'
  | 'candidate-id-mismatch'
  | 'runner-report-mismatch'

export class AdaptedSimulationWorkflowError extends Error {
  public constructor(
    public readonly code: AdaptedSimulationWorkflowErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AdaptedSimulationWorkflowError'
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
