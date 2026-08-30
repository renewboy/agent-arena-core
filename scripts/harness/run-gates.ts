import { spawn } from 'node:child_process'

interface Gate {
  readonly label: string
  readonly args: readonly string[]
}

const repositoryGates: readonly Gate[] = [
  { label: 'architecture', args: ['run', 'check:architecture'] },
]
const codeGates: readonly Gate[] = [
  { label: 'typecheck', args: ['run', 'typecheck'] },
  { label: 'lint', args: ['run', 'lint'] },
  { label: 'format', args: ['run', 'format:check'] },
  { label: 'hygiene', args: ['run', 'hygiene'] },
]

const staticPhases = [repositoryGates, codeGates] as const
const phases: Readonly<Record<string, readonly (readonly Gate[])[]>> = {
  static: staticPhases,
  all: [
    ...staticPhases,
    [{ label: 'tests', args: ['test:coverage'] }],
    [{ label: 'build', args: ['build'] }],
  ],
}

const mode = process.argv[2] ?? 'all'
const selected = phases[mode]
if (!selected) throw new Error(`Unknown gate mode ${mode}`)

for (const phase of selected) {
  const results = await Promise.all(phase.map(runGate))
  if (results.some((result) => result !== 0)) process.exit(1)
}

process.stdout.write(`harness ${mode}: ok\n`)

function runGate(gate: Gate): Promise<number> {
  process.stdout.write(`\n[${gate.label}] pnpm ${gate.args.join(' ')}\n`)
  return new Promise((resolvePromise, reject) => {
    const child = spawn('pnpm', [...gate.args], { stdio: 'inherit', shell: false })
    child.once('error', reject)
    child.once('exit', (code) => resolvePromise(code ?? 1))
  })
}
