import { spawn } from 'node:child_process'

export interface RepositoryGate {
  readonly label: string
  readonly command: string
  readonly args: readonly string[]
}

export interface GateExecutionOptions {
  readonly cwd?: string
  readonly onStart?: (gate: RepositoryGate) => void
  readonly execute?: (gate: RepositoryGate, cwd?: string) => Promise<number>
}

export async function runGatePhases(
  phases: readonly (readonly RepositoryGate[])[],
  options: GateExecutionOptions = {},
): Promise<void> {
  const execute = options.execute ?? executeGate
  for (const phase of phases) {
    const results = await Promise.all(
      phase.map(async (gate) => {
        options.onStart?.(gate)
        return execute(gate, options.cwd)
      }),
    )
    const failed = phase.filter((_, index) => results[index] !== 0)
    if (failed.length > 0) {
      throw new Error(`Repository gates failed: ${failed.map((gate) => gate.label).join(', ')}`)
    }
  }
}

function executeGate(gate: RepositoryGate, cwd?: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(gate.command, [...gate.args], {
      ...(cwd ? { cwd } : {}),
      stdio: 'inherit',
      shell: false,
    })
    child.once('error', reject)
    child.once('exit', (code) => resolvePromise(code ?? 1))
  })
}
