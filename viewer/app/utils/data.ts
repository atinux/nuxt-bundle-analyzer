// Types of the files `nuxt analyze` writes for each run, and what the comparison needs from them.

export interface Run {
  name: string
  slug: string
  startTime: number
  endTime: number
  current: boolean
  /** The commit the run was built from, in the history of a branch. */
  commit?: Commit
}

/** A commit in the history of a branch, as the hosted viewer stores it with the total of each build. */
export interface Commit {
  sha: string
  message?: string
  time: number
  sizes: Partial<Record<Env, Sizes>>
  /** The largest packages of each build, by name, when the viewer recorded them. */
  packages?: Partial<Record<Env, Record<string, Sizes>>>
}

/** The reports `nuxt analyze` writes with Sonda, named after the bundle they describe. */
export type Env = 'client' | 'nitro'
export type Metric = 'uncompressed' | 'gzip' | 'brotli'

export interface Sizes {
  uncompressed: number
  gzip: number
  brotli: number
}

/** The part of Sonda's JSON report used here; see https://sonda.dev/features/json-report. */
export interface SondaReport {
  resources: Array<Sizes & {
    kind: 'filesystem' | 'sourcemap' | 'asset' | 'chunk'
    name: string
    /** For a `chunk`, the output file it is part of. */
    parent?: string | null
  }>
  /** The import graph. An `entrypoint` connects an output file to the source that starts it. */
  connections: Array<{
    kind: 'import' | 'require' | 'dynamic-import' | 'entrypoint' | 'sourcemap'
    source: string
    target: string
  }>
  /** Packages in the bundle, with every location they were bundled from. */
  dependencies: Array<{ name: string, paths: string[] }>
  /** Warnings, such as a loop of imports, with the modules in the loop. */
  issues: Array<{ type: string, data?: { cycle?: string[] } }>
}

/** One of the copies of a package bundled from more than one location. */
export interface PackageCopy extends Sizes {
  /** Where the copy was bundled from, such as `node_modules/.pnpm/hookable@5.5.3/node_modules/hookable`. */
  path: string
  /** The version, when the location names it, as pnpm's does. */
  version?: string
  /** Files outside the package that import this copy. */
  importers: string[]
}

export type ImportKind = 'import' | 'dynamic-import'

/** What the detail panel shows: one source file, or a package with all its files. */
export interface Target {
  kind: 'file' | 'package'
  id: string
}

/** A client output file in `nuxt.json`, keyed by its path in the client bundle (for example `_nuxt/entry.js`). */
interface Chunk {
  file: string
  /** The page, layout or component the chunk was split for, relative to the project. */
  src?: string
  type: 'js' | 'css' | 'asset'
  size: number
  gzip: number
  brotli: number
  isEntry?: boolean
  isDynamicEntry?: boolean
  imports: string[]
  dynamicImports: string[]
  css: string[]
}

export interface Route {
  path: string
  name?: string
  entries: string[]
}

/** An HTML page prerendered with `--prerender`, with the client files its HTML preloads. */
export interface PrerenderedPage {
  url: string
  /** The HTML document. */
  size: number
  gzip: number
  brotli: number
  /** Client JS and CSS the HTML preloads, as `chunks` keys. */
  files: string[]
}

export interface NuxtData {
  version: 1
  routes: Route[]
  chunks: Record<string, Chunk>
  prerendered?: PrerenderedPage[]
}

/** A source file's share of a bundle, summed over the output files it ends up in. */
export interface Source extends Sizes {
  id: string
  package?: string
}

/** A source file's share of one output file. */
export interface Part extends Sizes {
  id: string
  package?: string
  /** The output file, as Sonda names it. */
  asset: string
}

export interface Bundle extends Sizes {
  sources: Source[]
  parts: Part[]
  /** Output files, as Sonda names them. */
  assets: Array<Sizes & { name: string }>
  /** For each source, the sources that import it and how. */
  importers: Map<string, Map<string, ImportKind>>
  /** Sources that start an output file. */
  entries: Set<string>
  /** Packages bundled from more than one location, such as two versions, with each copy. */
  duplicates: Map<string, PackageCopy[]>
  /** Loops of imports, each starting from its first file, which the last one imports again. */
  cycles: string[][]
}

export interface RunData {
  run: Run
  bundles: Partial<Record<Env, Bundle>>
  routes: Route[]
  chunks: Record<string, Chunk>
  prerendered: PrerenderedPage[]
}

const PACKAGE_RE = /^node_modules\/((?:@[^/]+\/)?[^/]+)/
const PARENT_DIRS_RE = /^(?:\.\.\/)+/
/** The version in a pnpm location, such as `.pnpm/@vue+shared@3.5.44/` or `.pnpm/unctx@3.0.1_magic-string@1.4.3/`. */
const PNPM_VERSION_RE = /\.pnpm\/@?[^@/]+@([^_/]+)/

/**
 * Sonda names sources relative to the directory `nuxt analyze` ran in. Dependencies are named
 * after their package, wherever the package manager put them, so runs compare by package.
 */
export function normalizeId(name: string): string {
  let path = name.replaceAll('\\', '/')
  // Nuxt's virtual modules carry their encoded path, such as `virtual:nuxt:.nuxt%2Ffetch.mjs`.
  const virtual = path.indexOf('virtual:')
  if (virtual !== -1) {
    path = decodeURIComponent(path.slice(virtual).replace(/^virtual:nuxt:/, ''))
  }
  const buildDir = path.lastIndexOf('.nuxt/')
  if (buildDir !== -1) {
    // Sonda resolves the client build's own sources against the build directory, so
    // `.nuxt/app/pages/index.vue` is `app/pages/index.vue`; files Nuxt generates stay in `.nuxt`.
    const rest = path.slice(buildDir + '.nuxt/'.length)
    if (virtual !== -1 || rest.startsWith('dist/')) {
      return `.nuxt/${rest}`
    }
    // Dependencies too, so with a build directory in `node_modules/.cache`, as nuxt.com has, they
    // read `.nuxt/node_modules/.pnpm/vue@3.5.44/node_modules/vue/…` and go on to be named below.
    path = rest
  }
  const modules = path.lastIndexOf('node_modules/')
  if (modules !== -1) {
    return path.slice(modules)
  }
  return path.replace(PARENT_DIRS_RE, '')
}

function toBundle(report: SondaReport): Bundle {
  const bundle: Bundle = {
    uncompressed: 0,
    gzip: 0,
    brotli: 0,
    sources: [],
    parts: [],
    assets: [],
    importers: new Map(),
    entries: new Set(),
    duplicates: new Map(),
    cycles: [],
  }
  const sources = new Map<string, Source>()

  // Sources name every copy of a package the same, so each copy is told apart by its location in
  // Sonda's names, the longest one that matches as one location can be inside another.
  const copies = (report.dependencies ?? []).filter(dependency => dependency.paths.length > 1).flatMap(dependency => dependency.paths.map(path => ({
    name: dependency.name,
    copy: {
      path: path.replace(PARENT_DIRS_RE, ''),
      version: PNPM_VERSION_RE.exec(path)?.[1],
      uncompressed: 0,
      gzip: 0,
      brotli: 0,
      importers: new Set<string>(),
    },
  })))
  const copyOf = (name: string) => {
    const path = name.replaceAll('\\', '/')
    let found: typeof copies[number] | undefined
    for (const entry of copies) {
      if (path.includes(`${entry.copy.path}/`) && entry.copy.path.length > (found?.copy.path.length ?? 0)) {
        found = entry
      }
    }
    return found?.copy
  }
  for (const resource of report.resources) {
    const sizes = { uncompressed: resource.uncompressed, gzip: resource.gzip ?? 0, brotli: resource.brotli ?? 0 }
    if (resource.kind === 'asset') {
      bundle.assets.push({ name: resource.name, ...sizes })
      bundle.uncompressed += sizes.uncompressed
      bundle.gzip += sizes.gzip
      bundle.brotli += sizes.brotli
    }
    else if (resource.kind === 'chunk') {
      const id = normalizeId(resource.name)
      const pkg = packageOf(id)
      bundle.parts.push({
        id,
        package: pkg,
        asset: resource.parent ?? '',
        ...sizes,
      })
      const copy = copyOf(resource.name)
      if (copy) {
        copy.uncompressed += sizes.uncompressed
        copy.gzip += sizes.gzip
        copy.brotli += sizes.brotli
      }
      const source = sources.get(id) ?? {
        id,
        package: pkg,
        uncompressed: 0,
        gzip: 0,
        brotli: 0,
      }
      source.uncompressed += sizes.uncompressed
      source.gzip += sizes.gzip
      source.brotli += sizes.brotli
      sources.set(id, source)
    }
  }
  bundle.sources = [
    ...sources.values(),
  ]

  for (const connection of report.connections ?? []) {
    // The parts of a Vue component, such as `index.vue?vue&type=script`, count as the component itself.
    const target = normalizeId(connection.target.split('?')[0]!)
    if (connection.kind === 'entrypoint') {
      bundle.entries.add(target)
      continue
    }
    const source = normalizeId(connection.source.split('?')[0]!)
    if (source === target || connection.kind === 'sourcemap') {
      continue
    }
    const copy = copyOf(connection.target)
    if (copy && copyOf(connection.source) !== copy) {
      copy.importers.add(source)
    }
    const importers = bundle.importers.get(target) ?? new Map<string, ImportKind>()
    // A static import loads the file before the importer runs, so it wins over a dynamic one.
    if (importers.get(source) !== 'import') {
      importers.set(source, connection.kind === 'dynamic-import'
        ? 'dynamic-import'
        : 'import')
    }
    bundle.importers.set(target, importers)
  }

  for (const { name, copy } of copies) {
    bundle.duplicates.set(name, [
      ...bundle.duplicates.get(name) ?? [],
      {
        ...copy,
        importers: [...copy.importers].sort(),
      },
    ])
  }

  const cycles = new Map<string, string[]>()
  for (const issue of report.issues ?? []) {
    if (issue.type !== 'circular-import' || !issue.data?.cycle) {
      continue
    }
    // Sonda closes the loop with its first module, and lists the parts of a Vue component apart.
    const cycle = issue.data.cycle.map(name => normalizeId(name.split('?')[0]!)).filter((id, index, ids) => id !== ids[index - 1])
    if (cycle.length > 1 && cycle.at(-1) === cycle[0]) {
      cycle.pop()
    }
    if (cycle.length < 2) {
      continue
    }
    // The same loop can be reported from any of its files, so it starts from the first in order.
    const start = cycle.indexOf([...cycle].sort()[0]!)
    const loop = [
      ...cycle.slice(start),
      ...cycle.slice(0, start),
    ]
    cycles.set(loop.join('\n'), loop)
  }
  bundle.cycles = [
    ...cycles.values(),
  ]
  return bundle
}

/**
 * The chain of imports that leads to a source, starting where the chain begins: the bundle's
 * entry, or a file nothing is recorded to import. Sonda records the imports Nuxt's virtual modules
 * make, such as `#build/routes` loading each page, but not the imports of them, so chains through
 * the router start at those modules. The chain with the fewest imports on demand wins, as it is
 * the reason a file is loaded up front, then the shortest one. Each step says how the previous one
 * imports it.
 */
export function importChain(bundle: Bundle, id: string): { id: string, kind?: ImportKind }[] {
  const next = new Map<string, { id: string, kind: ImportKind }>()
  const visited = new Set([id])
  // Each round searches through static imports only; imports on demand wait for the next round.
  let round = [id]
  while (round.length > 0) {
    const onDemand: [importer: string, imported: string][] = []
    const queue = [...round]
    while (queue.length > 0) {
      const current = queue.shift()!
      const importers = bundle.importers.get(current)
      if (!importers?.size) {
        const chain: { id: string, kind?: ImportKind }[] = [
          { id: current },
        ]
        for (let step = next.get(current); step; step = next.get(step.id)) {
          chain.push({ id: step.id, kind: step.kind })
        }
        return chain
      }
      for (const [importer, kind] of importers) {
        if (visited.has(importer)) {
          continue
        }
        if (kind === 'dynamic-import') {
          onDemand.push([importer, current])
          continue
        }
        visited.add(importer)
        next.set(importer, { id: current, kind })
        queue.push(importer)
      }
    }
    round = []
    for (const [importer, imported] of onDemand) {
      if (!visited.has(importer)) {
        visited.add(importer)
        next.set(importer, { id: imported, kind: 'dynamic-import' })
        round.push(importer)
      }
    }
  }
  // Every file that leads here is imported by another one in a cycle.
  return []
}

const PULL_RE = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/
const TREE_RE = /^\/([\w.-]+)\/([\w.-]+)\/tree\/(\w[\w.-]*)\/?$/

/** The pull request the hosted viewer shows, from its path, such as `/nuxt/nuxt.com/pull/1234`. */
export function hostedPull() {
  const [, owner, repo, pull] = PULL_RE.exec(location.pathname) ?? []
  return owner && repo && pull
    ? {
        owner,
        repo,
        pull: Number(pull),
      }
    : undefined
}

/** The branch whose history the hosted viewer shows, from its path, such as `/nuxt/nuxt.com/tree/main`. */
export function hostedBranch() {
  const [, owner, repo, branch] = TREE_RE.exec(location.pathname) ?? []
  return owner && repo && branch
    ? {
        owner,
        repo,
        branch,
      }
    : undefined
}

async function fetchJson<T>(url: string): Promise<T | undefined> {
  const response = await fetch(url)
  return response.ok
    ? response.json() as Promise<T>
    : undefined
}

/**
 * The runs to view, newest first: from `nuxt-bundle-analyzer` in `/data`, the hosted viewer's
 * store of a pull request, or one run for each commit in the history of a branch.
 */
export async function fetchRuns(): Promise<Run[]> {
  const pull = hostedPull()
  const branch = hostedBranch()
  if (branch) {
    const history = await fetchJson<Commit[]>(`/api/reports/${branch.owner}/${branch.repo}/tree/${branch.branch}/history.json`) ?? []
    return history.map((commit, index) => ({
      name: commit.sha.slice(0, 7),
      slug: commit.sha,
      startTime: commit.time,
      endTime: commit.time,
      current: index === history.length - 1,
      commit,
    })).reverse()
  }
  const runs = await fetchJson<Run[]>(pull
    ? `/api/reports/${pull.owner}/${pull.repo}/pull/${pull.pull}/runs.json`
    : '/data/runs.json')
  return runs ?? []
}

/** Where the files of a run are. */
function runBase(run: Run) {
  const pull = hostedPull()
  const branch = hostedBranch()
  return branch
    ? `/api/reports/${branch.owner}/${branch.repo}/commit/${run.slug}`
    : pull
      ? `/api/reports/${pull.owner}/${pull.repo}/pull/${pull.pull}/${encodeURIComponent(run.slug)}`
      : `/data/${encodeURIComponent(run.slug)}`
}

export async function fetchRun(run: Run): Promise<RunData> {
  const base = runBase(run)
  const [client, nitro, nuxt] = await Promise.all([
    fetchJson<SondaReport>(`${base}/client.json`),
    fetchJson<SondaReport>(`${base}/nitro.json`),
    fetchJson<NuxtData>(`${base}/nuxt.json`),
  ])
  return toRunData(run, { client, nitro }, nuxt)
}

/** A run from the files it was written as, which `nuxt-bundle-analyzer comment` reads from disk. */
export function toRunData(run: Run, reports: Partial<Record<Env, SondaReport>>, nuxt: NuxtData | undefined): RunData {
  const data: RunData = {
    run,
    bundles: {},
    routes: nuxt?.routes ?? [],
    chunks: nuxt?.chunks ?? {},
    // Uploaded runs are only checked to be JSON, so malformed pages are left out here.
    prerendered: Array.isArray(nuxt?.prerendered)
      ? nuxt.prerendered.filter(page => typeof page?.url === 'string' && Array.isArray(page.files))
      : [],
  }
  for (const env of ['client', 'nitro'] as const) {
    const report = reports[env]
    if (report) {
      data.bundles[env] = toBundle(report)
    }
  }
  return data
}

/** Files loaded before a route renders: its entries and everything they import statically. */
function routeFiles(data: RunData, route: Route): Chunk[] {
  const loaded = new Map<string, Chunk>()
  const queue = [...route.entries]
  while (queue.length > 0) {
    const file = queue.pop()!
    const chunk = data.chunks[file]
    if (loaded.has(file) || !chunk) {
      continue
    }
    loaded.set(file, chunk)
    queue.push(...chunk.imports, ...chunk.css)
  }
  return [
    ...loaded.values(),
  ]
}

type ChunkKind = 'entry' | 'page' | 'layout' | 'component' | 'asyncData' | 'shared' | 'nuxt' | 'route' | 'app' | 'nitro'

export const chunkKindLabels: Record<ChunkKind, string> = {
  entry: 'Entry',
  page: 'Page',
  layout: 'Layout',
  component: 'Component',
  asyncData: 'Async Data',
  shared: 'Shared',
  nuxt: 'Nuxt',
  // Nitro's server routes, such as `server/api/hello.ts`, its build of the Vue app, and its runtime.
  route: 'Server Route',
  app: 'Vue App',
  nitro: 'Nitro',
}

/** A JavaScript output file of the client or Nitro build, with what it is made of. */
export interface ChunkInfo extends Sizes {
  file: string
  kind: ChunkKind
  src?: string
  /** Stylesheets loaded with the chunk. */
  css: Sizes
  /** Source files in the chunk, with their share of its size. */
  contents: Part[]
  /**
   * Routes that load the chunk before rendering, `all` when every route does, `lazy` when only
   * loaded on demand. Nitro's chunks are not loaded by routes in the browser, so they have none.
   */
  loadedBy?: 'all' | 'lazy' | string[]
  imports: string[]
  dynamicImports: string[]
}

export interface PageInfo {
  /** The page component, such as `app/pages/blog/[slug].vue`. */
  file: string
  chunk: ChunkInfo
  /** The route the page renders, unless it is a parent page that only renders its children. */
  route?: string
  /** Routes that render the page: one for a page, several for a parent page with children. */
  routes: string[]
  /** What its route loads before rendering, when the page is a route of its own. */
  initial?: Sizes
  /** Other chunks its route loads before rendering, apart from those every route loads. */
  loads: ChunkInfo[]
  /** Chunks the page loads on demand, such as lazy components. */
  lazy: ChunkInfo[]
}

export type SourceKind = 'component' | 'file' | 'dependency' | 'nuxt'

/** The package a source is from, such as `vue` for `node_modules/vue/dist/vue.js`. */
export function packageOf(id: string): string | undefined {
  return PACKAGE_RE.exec(id)?.[1]
}

/** The pages directory a file is in, such as `app/pages/`, which narrow screens leave out. */
export function pagesDir(file: string) {
  return file.match(/^(?:.*?\/)?pages\//)?.[0] ?? ''
}

/** Groups a source as one of the project's components or files, a dependency, or code Nuxt generates. */
export function sourceKind(part: Pick<Part, 'id' | 'package'>): SourceKind {
  if (part.package) {
    return 'dependency'
  }
  if (part.id.startsWith('.nuxt/') || part.id.startsWith('[') || part.id.startsWith('(virtual)')) {
    return 'nuxt'
  }
  return part.id.endsWith('.vue')
    ? 'component'
    : 'file'
}

const PAGES_RE = /(?:^|\/)pages\//
const LAYOUTS_RE = /(?:^|\/)layouts\//
/**
 * Nuxt's `experimental.extractAsyncDataHandlers` moves each `useAsyncData` handler to its own
 * chunk, in the folder of the file that calls it, such as `app/pages/async-data-chunk-3.js`.
 */
const ASYNC_DATA_CHUNK_RE = /(?:^|\/)async-data-chunk-\d+\.js$/

/** `routeEntries` are the chunks routes start from: the app entry, layouts, and pages wherever they live. */
function chunkKind(chunk: Chunk, routeEntries: Set<string>): ChunkKind {
  if (chunk.isEntry) {
    return 'entry'
  }
  if (!chunk.src) {
    return 'shared'
  }
  if (ASYNC_DATA_CHUNK_RE.test(chunk.src)) {
    return 'asyncData'
  }
  // A page added with `extendPages`, such as Docus's `templates/landing.vue`, is outside `pages/`.
  if (routeEntries.has(chunk.file) && !LAYOUTS_RE.test(chunk.src)) {
    return 'page'
  }
  if (chunk.src.includes('node_modules/')) {
    return 'nuxt'
  }
  return PAGES_RE.test(chunk.src)
    ? 'page'
    : LAYOUTS_RE.test(chunk.src)
      ? 'layout'
      : 'component'
}

/** The JavaScript chunks of the client build, largest first. */
export function clientChunks(data: RunData): ChunkInfo[] {
  const loaded = data.routes.map(route => ({
    path: route.path,
    files: new Set(routeFiles(data, route).map(chunk => chunk.file)),
  }))
  const routeEntries = new Set(data.routes.flatMap(route => route.entries))
  const parts = data.bundles.client?.parts ?? []
  const chunks: ChunkInfo[] = []
  for (const chunk of Object.values(data.chunks)) {
    if (chunk.type !== 'js') {
      continue
    }
    const css = { uncompressed: 0, gzip: 0, brotli: 0 }
    for (const file of chunk.css) {
      css.uncompressed += data.chunks[file]?.size ?? 0
      css.gzip += data.chunks[file]?.gzip ?? 0
      css.brotli += data.chunks[file]?.brotli ?? 0
    }
    // Sonda names output files from the directory `nuxt analyze` ran in, `nuxt.json` from the client build.
    const contents = new Map<string, Part>()
    for (const part of parts) {
      if (part.asset.endsWith(`/${chunk.file}`)) {
        const merged = contents.get(part.id) ?? {
          ...part,
          uncompressed: 0,
          gzip: 0,
          brotli: 0,
        }
        merged.uncompressed += part.uncompressed
        merged.gzip += part.gzip
        merged.brotli += part.brotli
        contents.set(part.id, merged)
      }
    }
    const routes = loaded.filter(route => route.files.has(chunk.file)).map(route => route.path)
    chunks.push({
      file: chunk.file,
      kind: chunkKind(chunk, routeEntries),
      // Nuxt's own chunks, such as its entry, are named after their package rather than its location.
      // A source is named the way Sonda names it, so a page outside the project root, such as one
      // from a layer above it, still matches the file the details panel looks for.
      src: chunk.src?.includes('node_modules/')
        ? normalizeId(chunk.src).slice('node_modules/'.length)
        : chunk.src && normalizeId(chunk.src),
      uncompressed: chunk.size,
      gzip: chunk.gzip,
      brotli: chunk.brotli,
      css,
      contents: [
        ...contents.values(),
      ].sort((a, b) => b.uncompressed - a.uncompressed),
      loadedBy: routes.length === 0
        ? 'lazy'
        : routes.length === loaded.length
          ? 'all'
          : routes,
      imports: chunk.imports,
      dynamicImports: chunk.dynamicImports,
    })
  }
  return chunks.sort((a, b) => b.uncompressed - a.uncompressed)
}

const SCRIPT_RE = /\.[cm]?js$/

/** Groups a Nitro output file by the folder Nitro writes it to. */
function serverChunkKind(file: string): ChunkKind {
  if (!file.includes('/chunks/')) {
    return 'entry'
  }
  if (file.includes('/chunks/routes/')) {
    // Server routes, such as `server/api/hello.ts`, and the renderer of the Vue app.
    return 'route'
  }
  if (file.includes('/chunks/build/') || file.includes('/chunks/virtual/')) {
    // The server build of the Vue app, with its entry in `virtual/entry.mjs`.
    return 'app'
  }
  return file.includes('/chunks/nitro/')
    ? 'nitro'
    : 'shared'
}

/** The JavaScript output files of the Nitro build, largest first. */
export function serverChunks(data: RunData): ChunkInfo[] {
  const bundle = data.bundles.nitro
  if (!bundle) {
    return []
  }
  return bundle.assets.filter(asset => SCRIPT_RE.test(asset.name)).map((asset) => {
    const contents = new Map<string, Part>()
    for (const part of bundle.parts) {
      if (part.asset === asset.name) {
        const merged = contents.get(part.id) ?? {
          ...part,
          uncompressed: 0,
          gzip: 0,
          brotli: 0,
        }
        merged.uncompressed += part.uncompressed
        merged.gzip += part.gzip
        merged.brotli += part.brotli
        contents.set(part.id, merged)
      }
    }
    return {
      file: asset.name,
      kind: serverChunkKind(asset.name),
      uncompressed: asset.uncompressed,
      gzip: asset.gzip,
      brotli: asset.brotli,
      css: { uncompressed: 0, gzip: 0, brotli: 0 },
      contents: [
        ...contents.values(),
      ].sort((a, b) => b.uncompressed - a.uncompressed),
      imports: [],
      dynamicImports: [],
    }
  }).sort((a, b) => b.uncompressed - a.uncompressed)
}

/** Every page component, with the routes it renders and what they load. */
export function pages(data: RunData, chunks: ChunkInfo[]): PageInfo[] {
  return chunks.filter(chunk => chunk.kind === 'page').map((chunk) => {
    const routes = data.routes.filter(route => route.entries.includes(chunk.file))
    const own = routes.find(route => route.entries.at(-1) === chunk.file)
    const files = new Set(own
      ? routeFiles(data, own).map(file => file.file)
      : chunk.imports)
    return {
      file: chunk.src!,
      chunk,
      route: own?.path,
      routes: routes.map(route => route.path),
      initial: own && routeSize(data, own),
      loads: chunks.filter(other => other !== chunk && other.loadedBy !== 'all' && files.has(other.file)),
      lazy: chunks.filter(other => chunk.dynamicImports.includes(other.file)),
    }
  }).sort((a, b) => a.file.localeCompare(b.file))
}

function sumSizes(chunks: Chunk[]): Sizes {
  const sizes: Sizes = { uncompressed: 0, gzip: 0, brotli: 0 }
  for (const chunk of chunks) {
    sizes.uncompressed += chunk.size
    sizes.gzip += chunk.gzip
    sizes.brotli += chunk.brotli
  }
  return sizes
}

/** JavaScript and CSS loaded before a route renders, sized from the files on disk that `nuxt.json` records. */
export function routeSize(data: RunData, route: Route): Sizes {
  return sumSizes(routeFiles(data, route))
}

/** The JavaScript and CSS a prerendered URL's HTML preloads, as far as the run's chunks know them. */
function preloadedChunks(data: RunData, page: PrerenderedPage | undefined): Chunk[] {
  const chunks = new Set<Chunk>()
  for (const file of page?.files ?? []) {
    const chunk = data.chunks[file]
    if (chunk?.type === 'js' || chunk?.type === 'css') {
      chunks.add(chunk)
    }
  }
  return [...chunks]
}

/** A file a prerendered URL preloads: a JS chunk with those of its stylesheets the HTML preloads, or a stylesheet on its own. */
export interface PreloadedFile extends Sizes {
  file: string
  /** The JS chunk, which a stylesheet on its own has none of. */
  chunk?: ChunkInfo
}

export interface PrerenderedInfo {
  url: string
  /** The route whose page its HTML loads, unless none does, such as for an SPA shell. */
  route?: Route
  /** The chunk of that route's page. */
  page?: ChunkInfo
  /** The HTML document. */
  html: Sizes
  /** Every JS and CSS file its HTML preloads. */
  initial: Sizes
  /** What its route loads before rendering, as Pages shows it. */
  routeInitial?: Sizes
  /** Lazy-loaded components the page rendered: its HTML preloads them, but the route's static imports don't reach them. */
  added: PreloadedFile[]
  addedSize: Sizes
  /** Files its route loads that its HTML doesn't preload. */
  notLoaded: PreloadedFile[]
  /** Every file its HTML preloads. */
  files: PreloadedFile[]
}

/** Groups files as JS chunks, each with those of its stylesheets in the list, largest first. */
function groupFiles(chunks: Chunk[], infos: Map<string, ChunkInfo>): PreloadedFile[] {
  const listed = new Map(chunks.map(chunk => [chunk.file, chunk]))
  const claimed = new Set<string>()
  const files: PreloadedFile[] = []
  for (const chunk of chunks) {
    if (chunk.type !== 'js') {
      continue
    }
    const css = chunk.css.filter(file => listed.has(file) && !claimed.has(file))
    css.forEach(file => claimed.add(file))
    files.push({
      file: chunk.file,
      chunk: infos.get(chunk.file),
      ...sumSizes([
        chunk,
        ...css.map(file => listed.get(file)!),
      ]),
    })
  }
  for (const chunk of chunks) {
    if (chunk.type === 'css' && !claimed.has(chunk.file)) {
      files.push({
        file: chunk.file,
        ...sumSizes([chunk]),
      })
    }
  }
  return files.sort((a, b) => b.uncompressed - a.uncompressed)
}

/**
 * The route a prerendered URL renders. Candidates are the routes whose own page chunk its HTML
 * loads, and the one with the most of its entries in the HTML wins. Routes with the same entries,
 * such as the copies i18n makes for each locale, go to the longest static prefix of the URL.
 */
function prerenderedRoute(data: RunData, page: PrerenderedPage, pageChunks: Set<string>): Route | undefined {
  const files = new Set(page.files)
  const present = (route: Route) => route.entries.filter(file => files.has(file)).length
  const prefix = (route: Route) => {
    const path = route.path.split(':')[0]!.replace(/\/+$/, '')
    return path === '' || page.url === path || page.url.startsWith(`${path}/`)
      ? path.length
      : -1
  }
  return data.routes
    .filter(route => pageChunks.has(route.entries.at(-1)!) && files.has(route.entries.at(-1)!))
    .sort((a, b) => present(b) - present(a) || prefix(b) - prefix(a))[0]
}

/** Each prerendered URL, with the route it renders and what its HTML preloads over that route. */
export function prerenderedPages(data: RunData, chunks: ChunkInfo[]): PrerenderedInfo[] {
  const infos = new Map(chunks.map(chunk => [chunk.file, chunk]))
  const pageChunks = new Set(chunks.filter(chunk => chunk.kind === 'page').map(chunk => chunk.file))
  return data.prerendered.map((page) => {
    const route = prerenderedRoute(data, page, pageChunks)
    const preloaded = preloadedChunks(data, page)
    const routeChunks = route
      ? routeFiles(data, route)
      : []
    const inRoute = new Set(routeChunks)
    const inHtml = new Set(preloaded)
    const added = route
      ? preloaded.filter(chunk => !inRoute.has(chunk))
      : []
    return {
      url: page.url,
      route,
      page: route && infos.get(route.entries.at(-1)!),
      html: {
        uncompressed: Number(page.size) || 0,
        gzip: Number(page.gzip) || 0,
        brotli: Number(page.brotli) || 0,
      },
      initial: sumSizes(preloaded),
      routeInitial: route && routeSize(data, route),
      added: groupFiles(added, infos),
      addedSize: sumSizes(added),
      // Listed, so its route plus what it adds minus what it doesn't load is what its HTML preloads.
      notLoaded: groupFiles(routeChunks.filter(chunk => !inHtml.has(chunk)), infos),
      files: groupFiles(preloaded, infos),
    }
  })
}

/** A size in the base run and the current one, for one chunk, file or package. */
export interface Change {
  key: string
  base?: number
  current?: number
  delta: number
}

/** What changed between two sets of sizes, the largest changes first, leaving out what did not change. */
function changes(base: Map<string, number>, current: Map<string, number>, limit = Infinity): Change[] {
  return [
    ...new Set([
      ...base.keys(),
      ...current.keys(),
    ]),
  ]
    .map(key => ({
      key,
      base: base.get(key),
      current: current.get(key),
      delta: (current.get(key) ?? 0) - (base.get(key) ?? 0),
    }))
    .filter(change => change.delta !== 0 || change.base === undefined || change.current === undefined)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit)
}

/**
 * The output file a part is in, as both runs name it: `_nuxt/stats.js` for the client, or the
 * path in Nitro's output, such as `server/chunks/build/stats.mjs`. Sonda names them from wherever
 * the build ran, which differs between the base and the pull request.
 */
export function outputFile(asset: string) {
  const client = asset.lastIndexOf('/dist/client/')
  if (client !== -1) {
    return asset.slice(client + '/dist/client/'.length)
  }
  const output = asset.indexOf('.output/')
  return output === -1
    ? asset
    : asset.slice(output + '.output/'.length)
}

function sizeOf(chunk: Chunk, metric: Metric) {
  return metric === 'uncompressed'
    ? chunk.size
    : chunk[metric]
}

/**
 * Where a route's difference comes from: the files it loads before rendering that changed, and
 * the files and packages in them that changed, a package counted as a whole.
 */
export function routeChanges(base: RunData, current: RunData, path: string, metric: Metric) {
  return loadChanges(base, current, metric, (data) => {
    const route = data.routes.find(route => route.path === path)
    return route
      ? routeFiles(data, route)
      : []
  })
}

/** Where a prerendered URL's difference comes from, as {@link routeChanges} tells it for a route. */
export function pageChanges(base: RunData, current: RunData, url: string, metric: Metric) {
  return loadChanges(base, current, metric, data => preloadedChunks(data, data.prerendered.find(page => page.url === url)))
}

/** The changes between the files each run loads, and between the files and packages in them. */
function loadChanges(base: RunData, current: RunData, metric: Metric, filesOf: (data: RunData) => Chunk[]) {
  const measure = (data: RunData) => {
    const files = filesOf(data)
    const chunks = new Map(files.map(chunk => [
      chunk.file,
      sizeOf(chunk, metric),
    ]))
    const sources = new Map<string, number>()
    for (const part of data.bundles.client?.parts ?? []) {
      if (chunks.has(outputFile(part.asset))) {
        const key = part.package
          ? `node_modules/${part.package}`
          : part.id
        sources.set(key, (sources.get(key) ?? 0) + part[metric])
      }
    }
    return { chunks, sources }
  }
  const before = measure(base)
  const after = measure(current)
  return {
    chunks: changes(before.chunks, after.chunks, 8),
    sources: changes(before.sources, after.sources, 8),
  }
}

/** The chunks a file or package is in, in both runs, with its size in each. */
export function locationChanges(base: RunData, current: RunData, env: Env, target: Target, metric: Metric) {
  const measure = (data: RunData) => {
    const sizes = new Map<string, number>()
    for (const part of data.bundles[env]?.parts ?? []) {
      if (target.kind === 'package'
        ? part.package === target.id
        : part.id === target.id) {
        const name = outputFile(part.asset)
        sizes.set(name, (sizes.get(name) ?? 0) + part[metric])
      }
    }
    return sizes
  }
  return changes(measure(base), measure(current))
}

/** Two builds of the same code differ by a few bytes, such as the build ID, so smaller changes of a route or a URL are left out. */
export const MIN_CHANGE = 100

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes)
  if (abs < 1000) {
    return `${bytes} B`
  }
  if (abs < 1000 * 1000) {
    return `${(bytes / 1000).toFixed(abs < 10_000
      ? 2
      : 1)} kB`
  }
  return `${(bytes / 1000 / 1000).toFixed(2)} MB`
}

export function formatDelta(bytes: number): string {
  if (bytes === 0) {
    return '±0 B'
  }
  return `${bytes > 0
    ? '+'
    : '−'}${formatBytes(Math.abs(bytes))}`
}
