import { sourceFiles, text, localPath, failIfErrors, projectRoot } from './files.js'
import {
  dependencyPolicy,
  fileLinePolicy,
  runRepositoryPolicies,
} from '../../packages/harness/src/index.js'

const roots = [
  'packages/acp-runtime/src',
  'packages/contracts/src',
  'packages/harness/src',
  'packages/ruleset/src',
  'packages/game-runtime/src',
  'packages/prompt-runtime/src',
  'packages/match-runtime/src',
  'packages/simulation/src',
  'packages/storage-sqlite/src',
  'packages/testkit/src',
  'packages/trajectory/src',
  'examples/hidden-team/src',
  'examples/reaction-card/src',
] as const

const allowedInternalDependencies: Readonly<Record<string, ReadonlySet<string>>> = {
  'packages/acp-runtime': new Set(),
  'packages/contracts': new Set(),
  'packages/harness': new Set(),
  'packages/ruleset': new Set(['contracts']),
  'packages/game-runtime': new Set(['contracts']),
  'packages/prompt-runtime': new Set(['contracts']),
  'packages/match-runtime': new Set(['contracts', 'game-runtime']),
  'packages/simulation': new Set(['contracts']),
  'packages/storage-sqlite': new Set(['contracts']),
  'packages/testkit': new Set(['contracts', 'match-runtime']),
  'packages/trajectory': new Set(['contracts']),
  'examples/hidden-team': new Set([
    'contracts',
    'ruleset',
    'game-runtime',
    'prompt-runtime',
    'match-runtime',
    'simulation',
    'testkit',
  ]),
  'examples/reaction-card': new Set(['contracts', 'ruleset', 'game-runtime']),
}

const files = await sourceFiles(roots, new Set(['.ts', '.tsx']))
const errors: string[] = []
const maxSourceFileLines = 600

const owners = Object.fromEntries(
  Object.entries(allowedInternalDependencies).map(([owner, allowedDependencies]) => [
    owner,
    {
      sourceRoot: `${owner}/src`,
      packageName: owner.startsWith('examples/')
        ? `example-${owner.slice('examples/'.length)}`
        : owner.slice('packages/'.length),
      allowedDependencies,
    },
  ]),
)

await runRepositoryPolicies([
  dependencyPolicy({ projectRoot, scope: '@agent-arena', owners }),
  fileLinePolicy({
    projectRoot,
    roots,
    extensions: new Set(['.ts', '.tsx']),
    maximumLines: maxSourceFileLines,
  }),
]).catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error))
})

for (const path of files) {
  const relativePath = localPath(path)
  const content = await text(path)
  if (relativePath.startsWith('packages/')) {
    if (/['"]@agentwolf\//.test(content)) {
      errors.push(`${relativePath} must not import AgentWolf product packages`)
    }
    if (/\b(?:werewolf|sheriff|witch)\b/i.test(content)) {
      errors.push(`${relativePath} contains product game terminology`)
    }
    if (/['"`](?:day|night)(?:[.-][a-z0-9-]+)?['"`]/i.test(content)) {
      errors.push(`${relativePath} contains a product phase semantic`)
    }
  }
}

failIfErrors(errors, 'architecture')
