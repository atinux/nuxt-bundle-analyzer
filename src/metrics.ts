import type { Metric as Compression, Env, RunData, Sizes } from '../viewer/app/utils/data'

import { clientChunks, prerenderedPages, routeSize } from '../viewer/app/utils/data'
import { bytes } from './comment'

export const METRIC_GROUPS = [
  'totals',
  'types',
  'routes',
  'urls',
  'packages',
] as const
export type MetricGroup = typeof METRIC_GROUPS[number]
/** Every group but `packages`, which has one metric per package and would crowd a merge request's widget. */
export const DEFAULT_METRIC_GROUPS: MetricGroup[] = ['totals', 'types', 'routes', 'urls']
export const COMPRESSIONS: Compression[] = ['uncompressed', 'gzip', 'brotli']
export const REPORTERS = ['prometheus', 'github-action-benchmark'] as const
export type Reporter = typeof REPORTERS[number]

export interface MetricsOptions {
  reporter?: Reporter
  groups?: MetricGroup[]
  compressions?: Compression[]
}

interface Sample {
  /** The Prometheus metric, whose samples differ by their labels. */
  name: string
  labels: Record<string, string>
  value: number
  /** The name github-action-benchmark charts it under. */
  title: string
}

const HELP: Record<string, string> = {
  nuxt_bundle_bytes: 'Total size of the client or server build.',
  nuxt_bundle_origin_bytes: 'Size of the client or server build, split into the app\'s own code and its dependencies.',
  nuxt_client_assets_bytes: 'Total size of the client build\'s files, by type.',
  nuxt_route_initial_bytes: 'JavaScript and CSS a route loads before it renders.',
  nuxt_url_initial_bytes: 'JavaScript and CSS the HTML of a prerendered URL preloads.',
  nuxt_url_html_bytes: 'Size of the HTML of a prerendered URL.',
  nuxt_package_bytes: 'Size of a package in the client or server build.',
}

const BUNDLES: Array<[env: Env, label: 'client' | 'server']> = [
  ['client', 'client'],
  ['nitro', 'server'],
]

function emptySizes(): Sizes {
  return { uncompressed: 0, gzip: 0, brotli: 0 }
}

function addSizes(total: Sizes, sizes: Sizes) {
  total.uncompressed += bytes(sizes.uncompressed)
  total.gzip += bytes(sizes.gzip)
  total.brotli += bytes(sizes.brotli)
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The sizes of a run, one sample per size and compression. */
export function collectMetrics(data: RunData, { groups = DEFAULT_METRIC_GROUPS, compressions = COMPRESSIONS }: MetricsOptions = {}): Sample[] {
  const samples: Sample[] = []
  const add = (name: string, labels: Record<string, string>, sizes: Sizes, title: string) => {
    for (const compression of compressions) {
      samples.push({
        name,
        labels: { ...labels, compression },
        value: bytes(sizes[compression]),
        title: `${title} (${compression})`,
      })
    }
  }

  if (groups.includes('totals')) {
    for (const [env, bundle] of BUNDLES) {
      const sources = data.bundles[env]
      if (!sources) {
        continue
      }
      add('nuxt_bundle_bytes', { bundle }, sources, `${capitalize(bundle)} build`)
      const app = emptySizes()
      const dependencies = emptySizes()
      for (const source of sources.sources) {
        addSizes(source.package
          ? dependencies
          : app, source)
      }
      add('nuxt_bundle_origin_bytes', { bundle, origin: 'app' }, app, `${capitalize(bundle)} build, app code`)
      add('nuxt_bundle_origin_bytes', { bundle, origin: 'dependencies' }, dependencies, `${capitalize(bundle)} build, dependencies`)
    }
  }

  const chunks = Object.values(data.chunks)
  if (groups.includes('types') && chunks.length > 0) {
    const types = {
      js: emptySizes(),
      css: emptySizes(),
      asset: emptySizes(),
    }
    for (const chunk of chunks) {
      const total = types[chunk.type]
      if (total) {
        addSizes(total, { uncompressed: chunk.size, gzip: chunk.gzip, brotli: chunk.brotli })
      }
    }
    add('nuxt_client_assets_bytes', { type: 'js' }, types.js, 'Client JS files')
    add('nuxt_client_assets_bytes', { type: 'css' }, types.css, 'Client CSS files')
    // Many builds have no other files, such as fonts or images.
    if (chunks.some(chunk => chunk.type === 'asset')) {
      add('nuxt_client_assets_bytes', { type: 'asset' }, types.asset, 'Client other files')
    }
  }

  if (groups.includes('routes')) {
    for (const route of data.routes) {
      add('nuxt_route_initial_bytes', { route: route.path }, routeSize(data, route), `Route ${route.path} initial load`)
    }
  }

  if (groups.includes('urls') && data.prerendered.length > 0) {
    for (const page of prerenderedPages(data, clientChunks(data))) {
      add('nuxt_url_initial_bytes', { url: page.url }, page.initial, `URL ${page.url} initial load`)
      add('nuxt_url_html_bytes', { url: page.url }, page.html, `URL ${page.url} HTML`)
    }
  }

  if (groups.includes('packages')) {
    for (const [env, bundle] of BUNDLES) {
      const packages = new Map<string, Sizes>()
      for (const source of data.bundles[env]?.sources ?? []) {
        if (source.package) {
          const total = packages.get(source.package) ?? emptySizes()
          addSizes(total, source)
          packages.set(source.package, total)
        }
      }
      for (const name of [
        ...packages.keys(),
      ].sort()) {
        add('nuxt_package_bytes', { bundle, package: name }, packages.get(name)!, `Package ${name} in the ${bundle} build`)
      }
    }
  }

  return samples
}

/** Label values come from the app's code, such as its routes, so they can't end the value or the line. */
function labelValue(value: string) {
  return String(value).replace(/[\\"\n]/g, char => char === '\n'
    ? '\\n'
    : `\\${char}`)
}

/** The Prometheus text format, which GitLab's merge request widget and Pushgateway read. */
function renderPrometheus(samples: Sample[]) {
  const byName = new Map<string, Sample[]>()
  for (const sample of samples) {
    byName.set(sample.name, [
      ...byName.get(sample.name) ?? [],
      sample,
    ])
  }
  const lines: string[] = []
  for (const [name, list] of byName) {
    lines.push(`# HELP ${name} ${HELP[name]}`, `# TYPE ${name} gauge`)
    for (const sample of list) {
      const labels = Object.entries(sample.labels).map(([key, value]) => `${key}="${labelValue(value)}"`).join(',')
      lines.push(`${name}{${labels}} ${sample.value}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/** The custom format of github-action-benchmark's `customSmallerIsBetter` tool. */
function renderBenchmark(samples: Sample[]) {
  return `${JSON.stringify(samples.map(sample => ({
    name: sample.title,
    unit: 'bytes',
    value: sample.value,
  })), null, 2)}\n`
}

/** The sizes of a run in the format of a reporter. */
export function renderMetrics(data: RunData, options: MetricsOptions = {}): string {
  const samples = collectMetrics(data, options)
  return options.reporter === 'github-action-benchmark'
    ? renderBenchmark(samples)
    : renderPrometheus(samples)
}
