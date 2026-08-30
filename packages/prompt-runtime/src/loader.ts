import * as nunjucks from 'nunjucks'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { canImportPromptAudience } from './audience.js'
import type {
  LoadedPromptBundle,
  PromptBundleAdapter,
  PromptTemplateReference,
} from './contracts.js'

export function resolvePromptRoot(input: string): string {
  return realpathSync(input)
}

export function assertPromptRootHasNoLocale(root: string): void {
  const canonicalRoot = realpathSync(root)
  for (const path of recursiveFiles(canonicalRoot)) {
    const segments = relative(canonicalRoot, path).split(sep)
    if (
      segments.some((segment) => /^(?:[a-z]{2}(?:-[A-Z]{2})?|locale|locales|i18n)$/.test(segment))
    ) {
      throw new Error(`Prompt assets cannot introduce a locale axis: ${path}`)
    }
  }
}

export function loadPromptBundle<Manifest, BundleId extends string, Audience extends string>(
  id: BundleId,
  directory: string,
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
): LoadedPromptBundle<Manifest, BundleId> {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Missing Prompt bundle ${id} at ${directory}`)
  }
  const root = realpathSync(directory)
  const manifestPath = containedFile(root, 'bundle.json')
  const manifest = adapter.parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  if (adapter.bundleId(manifest) !== id) {
    throw new Error(`Prompt bundle ${id} declares ${adapter.bundleId(manifest)}`)
  }
  const templates = new Map<string, string>()
  for (const path of recursiveFiles(root)) {
    const localPath = relative(root, path).split(sep).join('/')
    if (localPath === 'bundle.json') continue
    if (!localPath.endsWith('.njk')) throw new Error(`Unsupported Prompt bundle file ${path}`)
    templates.set(`${id}/${localPath}`, readFileSync(path, 'utf8'))
  }
  for (const entry of adapter.templateReferences(manifest)) {
    const name = resolvePromptTemplate(id, entry.reference)
    if (bundleName(name) === id && !templates.has(name)) {
      throw new Error(`Prompt bundle ${id} references missing template ${entry.reference}`)
    }
  }
  return { id, root, manifest, templates }
}

export function promptEnvironment(
  bundles: readonly LoadedPromptBundle<unknown>[],
): nunjucks.Environment {
  const templates = new Map<string, string>()
  for (const bundle of bundles) {
    for (const [name, source] of bundle.templates) templates.set(name, source)
  }
  return new nunjucks.Environment(new FrozenTemplateLoader(templates), {
    autoescape: false,
    throwOnUndefined: true,
    trimBlocks: false,
    lstripBlocks: false,
  })
}

export function validatePromptBundleGraph<
  Manifest,
  BundleId extends string,
  Audience extends string,
>(
  bundles: readonly LoadedPromptBundle<Manifest, BundleId>[],
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
): void {
  const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]))
  for (const bundle of bundles) {
    for (const imported of adapter.imports(bundle.manifest)) {
      if (!byId.has(imported))
        throw new Error(`Prompt bundle ${bundle.id} imports missing ${imported}`)
    }
    for (const entry of externalManifestReferences(bundle, adapter)) {
      validateExternalReference(bundle, entry, byId, adapter)
    }
    for (const [name, source] of bundle.templates) {
      const usageAudience = templateAudience(bundle, name, adapter)
      for (const importedName of staticTemplateImports(source, name)) {
        const importedId = bundleName(importedName) as BundleId
        if (importedId !== bundle.id && !adapter.imports(bundle.manifest).includes(importedId)) {
          throw new Error(`Prompt template ${name} imports undeclared bundle ${importedId}`)
        }
        const importedBundle = byId.get(importedId)
        if (!importedBundle?.templates.has(importedName)) {
          throw new Error(`Prompt template ${name} imports missing ${importedName}`)
        }
        if (importedId !== bundle.id) {
          const shared = adapter
            .sharedTemplates(importedBundle.manifest)
            .find(
              (candidate) =>
                resolvePromptTemplate(importedId, candidate.reference) === importedName,
            )
          if (!shared)
            throw new Error(`Prompt template ${name} imports non-shared asset ${importedName}`)
          assertAudience(
            name,
            usageAudience,
            adapter.normalizeAudience(shared.audience),
            importedName,
          )
        }
      }
    }
  }
  validateImportCycles(bundles, adapter)
}

export function precompilePromptTemplates(
  environment: nunjucks.Environment,
  bundles: readonly LoadedPromptBundle<unknown>[],
): void {
  for (const bundle of bundles) {
    for (const name of bundle.templates.keys()) environment.getTemplate(name, true)
  }
}

export function resolvePromptTemplate(bundleId: string, reference: string): string {
  return reference.startsWith('@') ? reference.slice(1) : `${bundleId}/${reference}`
}

function externalManifestReferences<Manifest, BundleId extends string, Audience extends string>(
  bundle: LoadedPromptBundle<Manifest, BundleId>,
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
): PromptTemplateReference<Audience>[] {
  return adapter
    .templateReferences(bundle.manifest)
    .filter((entry) => entry.reference.startsWith('@'))
}

function validateExternalReference<Manifest, BundleId extends string, Audience extends string>(
  bundle: LoadedPromptBundle<Manifest, BundleId>,
  entry: PromptTemplateReference<Audience>,
  byId: ReadonlyMap<BundleId, LoadedPromptBundle<Manifest, BundleId>>,
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
): void {
  const importedName = resolvePromptTemplate(bundle.id, entry.reference)
  const importedId = bundleName(importedName) as BundleId
  if (importedId !== bundle.id && !adapter.imports(bundle.manifest).includes(importedId)) {
    throw new Error(`Prompt bundle ${bundle.id} references undeclared ${importedId}`)
  }
  const importedBundle = byId.get(importedId)
  const shared = importedBundle
    ? adapter
        .sharedTemplates(importedBundle.manifest)
        .find(
          (candidate) => resolvePromptTemplate(importedId, candidate.reference) === importedName,
        )
    : undefined
  if (!shared)
    throw new Error(`Prompt bundle ${bundle.id} references non-shared asset ${importedName}`)
  assertAudience(
    String(bundle.id),
    adapter.normalizeAudience(entry.audience),
    adapter.normalizeAudience(shared.audience),
    importedName,
  )
}

function templateAudience<Manifest, BundleId extends string, Audience extends string>(
  bundle: LoadedPromptBundle<Manifest, BundleId>,
  name: string,
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
) {
  const audiences = adapter
    .templateReferences(bundle.manifest)
    .filter((entry) => resolvePromptTemplate(bundle.id, entry.reference) === name)
    .map((entry) => adapter.normalizeAudience(entry.audience))
  return audiences.includes('public') ? 'public' : (audiences[0] ?? 'public')
}

function assertAudience(
  owner: string,
  importer: ReturnType<PromptBundleAdapter<unknown>['normalizeAudience']>,
  imported: ReturnType<PromptBundleAdapter<unknown>['normalizeAudience']>,
  reference: string,
): void {
  if (!canImportPromptAudience(importer, imported)) {
    throw new Error(`Prompt ${owner} cannot import ${imported} asset ${reference}`)
  }
}

function validateImportCycles<Manifest, BundleId extends string, Audience extends string>(
  bundles: readonly LoadedPromptBundle<Manifest, BundleId>[],
  adapter: PromptBundleAdapter<Manifest, BundleId, Audience>,
): void {
  const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]))
  const visiting = new Set<BundleId>()
  const visited = new Set<BundleId>()
  const visit = (id: BundleId, path: readonly BundleId[]): void => {
    if (visited.has(id)) return
    if (visiting.has(id))
      throw new Error(`Prompt bundle import cycle: ${[...path, id].join(' -> ')}`)
    visiting.add(id)
    for (const dependency of adapter.imports(byId.get(id)!.manifest))
      visit(dependency, [...path, id])
    visiting.delete(id)
    visited.add(id)
  }
  for (const bundle of bundles) visit(bundle.id, [])
}

function staticTemplateImports(source: string, name: string): string[] {
  const tags = source.match(/\{%\s*(?:include|extends|import|from)\b[^%]*%\}/g) ?? []
  return tags.map((tag) => {
    const match = tag.match(/["']([^"']+)["']/)
    if (!match) throw new Error(`Prompt template ${name} uses a dynamic import`)
    if (!match[1]!.includes('/'))
      throw new Error(`Prompt template ${name} uses an unqualified import`)
    return match[1]!
  })
}

function bundleName(name: string): string {
  const slash = name.indexOf('/')
  if (slash < 1) throw new Error(`Prompt template ${name} is not bundle-qualified`)
  return name.slice(0, slash)
}

class FrozenTemplateLoader extends nunjucks.Loader {
  public constructor(private readonly templates: ReadonlyMap<string, string>) {
    super()
  }

  public getSource(name: string): nunjucks.LoaderSource {
    const source = this.templates.get(name)
    if (source === undefined) throw new Error(`Unknown Prompt template ${name}`)
    return { src: source, path: name, noCache: false }
  }
}

function recursiveFiles(root: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Prompt bundles cannot contain symlinks: ${path}`)
    if (entry.isDirectory()) result.push(...recursiveFiles(path))
    else result.push(containedFile(root, entry.name))
  }
  return result
}

function containedFile(root: string, localPath: string): string {
  const path = realpathSync(resolve(root, localPath))
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Prompt path escapes bundle ${root}: ${localPath}`)
  }
  return path
}
