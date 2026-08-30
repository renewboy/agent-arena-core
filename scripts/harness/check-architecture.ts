import { sourceFiles, text, localPath, failIfErrors } from './files.js'

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

for (const path of files) {
  const relativePath = localPath(path)
  const content = await text(path)
  const lines = content.split(/\r?\n/).length
  if (lines > maxSourceFileLines) {
    errors.push(
      `${relativePath} has ${lines} lines; source files are limited to ${maxSourceFileLines}`,
    )
  }
  const owner = sourceOwner(relativePath)
  if (owner.startsWith('packages/')) {
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
  for (const match of content.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?['"](@agent-arena\/[^'"]+)['"]/g,
  )) {
    const imported = match[1]?.match(/^@agent-arena\/([^/]+)/)?.[1]
    if (!imported || imported === packageName(owner)) continue
    if (!allowedInternalDependencies[owner]?.has(imported)) {
      const line = content.slice(0, match.index).split(/\r?\n/).length
      errors.push(`${relativePath}:${line} cannot import @agent-arena/${imported}`)
    }
  }
}

for (const [owner, dependencies] of Object.entries(allowedInternalDependencies)) {
  const manifest = JSON.parse(await text(`${owner}/package.json`)) as {
    readonly name?: string
    readonly dependencies?: Readonly<Record<string, string>>
  }
  const expectedName = `@agent-arena/${packageName(owner)}`
  if (owner.startsWith('packages/') && manifest.name !== expectedName) {
    errors.push(`${owner}/package.json must declare ${expectedName}`)
  }
  for (const dependency of dependencies) {
    if (manifest.dependencies?.[`@agent-arena/${dependency}`] !== 'workspace:*') {
      errors.push(`${owner}/package.json must depend on @agent-arena/${dependency} via workspace:*`)
    }
  }
  for (const dependency of Object.keys(manifest.dependencies ?? {}).filter((name) =>
    name.startsWith('@agent-arena/'),
  )) {
    const packageDependency = dependency.slice('@agent-arena/'.length)
    if (!dependencies.has(packageDependency)) {
      errors.push(`${owner}/package.json declares disallowed internal dependency ${dependency}`)
    }
  }
}

failIfErrors(errors, 'architecture')

function sourceOwner(path: string): string {
  const match = path.match(/^((?:packages|examples)\/[^/]+)\/src\//)
  if (!match?.[1]) throw new Error(`Cannot determine source owner for ${path}`)
  return match[1]
}

function packageName(owner: string): string {
  return owner.slice(owner.indexOf('/') + 1)
}
