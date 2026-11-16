import type { Bundle, NuxtData, RunData, Source } from '../viewer/app/utils/data'

import { describe, expect, it } from 'vitest'

import { renderMetrics } from '../src/metrics'

type Chunk = NuxtData['chunks'][string]

function bundle(brotli: number, sources: Source[]): Bundle {
  return {
    uncompressed: brotli * 4,
    gzip: brotli * 2,
    brotli,
    sources,
    parts: [],
    assets: [],
    importers: new Map(),
    entries: new Set(),
    duplicates: new Map(),
    cycles: [],
  }
}

function source(id: string, brotli: number, pkg?: string): Source {
  return {
    id,
    package: pkg,
    uncompressed: brotli * 4,
    gzip: brotli * 2,
    brotli,
  }
}

function chunk(file: string, type: Chunk['type'], brotli: number, links: Partial<Pick<Chunk, 'imports' | 'dynamicImports' | 'css'>> = {}): Chunk {
  return {
    file,
    type,
    size: brotli * 4,
    gzip: brotli * 2,
    brotli,
    imports: [],
    dynamicImports: [],
    css: [],
    ...links,
  }
}

/** A route path that would end a Prometheus label value, and the line, if it was written as is. */
const TRICKY_ROUTE = '/a"b\\c\nd'

function run(): RunData {
  return {
    run: {
      name: 'ci',
      slug: 'ci',
      startTime: 0,
      endTime: 0,
      current: false,
    },
    bundles: {
      client: bundle(300, [
        source('app/app.vue', 40),
        source('node_modules/vue/dist/runtime.js', 150, 'vue'),
        source('node_modules/vue/dist/shared.js', 50, 'vue'),
        source('node_modules/@vueuse/core/index.js', 30, '@vueuse/core'),
      ]),
      nitro: bundle(900, [
        source('server/api/hello.ts', 100),
        source('node_modules/h3/dist/index.mjs', 300, 'h3'),
      ]),
    },
    routes: [
      {
        path: '/',
        entries: ['entry.js'],
      },
      {
        path: TRICKY_ROUTE,
        entries: ['lazy.js'],
      },
    ],
    chunks: {
      'entry.js': chunk('entry.js', 'js', 300, {
        imports: ['shared.js'],
        dynamicImports: ['lazy.js'],
        css: ['style.css'],
      }),
      'shared.js': chunk('shared.js', 'js', 150),
      'lazy.js': chunk('lazy.js', 'js', 250),
      'style.css': chunk('style.css', 'css', 60),
      'font.woff2': chunk('font.woff2', 'asset', 2800),
    },
    prerendered: [
      // The HTML also preloads the lazy chunk, and a font that isn't JavaScript or CSS.
      {
        url: '/',
        size: 480,
        gzip: 240,
        brotli: 120,
        files: [
          'entry.js',
          'shared.js',
          'style.css',
          'lazy.js',
          'font.woff2',
        ],
      },
    ],
  }
}

function samples(text: string) {
  return text.split('\n').filter(line => line && !line.startsWith('#'))
}

describe('renderMetrics', () => {
  it('writes the totals, file types, routes and prerendered URLs in the Prometheus format', () => {
    const text = renderMetrics(run(), {
      compressions: ['brotli'],
    })
    expect(samples(text)).toEqual([
      'nuxt_bundle_bytes{bundle="client",compression="brotli"} 300',
      'nuxt_bundle_bytes{bundle="server",compression="brotli"} 900',
      'nuxt_bundle_origin_bytes{bundle="client",origin="app",compression="brotli"} 40',
      'nuxt_bundle_origin_bytes{bundle="client",origin="dependencies",compression="brotli"} 230',
      'nuxt_bundle_origin_bytes{bundle="server",origin="app",compression="brotli"} 100',
      'nuxt_bundle_origin_bytes{bundle="server",origin="dependencies",compression="brotli"} 300',
      'nuxt_client_assets_bytes{type="js",compression="brotli"} 700',
      'nuxt_client_assets_bytes{type="css",compression="brotli"} 60',
      'nuxt_client_assets_bytes{type="asset",compression="brotli"} 2800',
      // The entry, the chunk it imports and its stylesheet, but not the chunk it imports dynamically.
      'nuxt_route_initial_bytes{route="/",compression="brotli"} 510',
      'nuxt_route_initial_bytes{route="/a\\"b\\\\c\\nd",compression="brotli"} 250',
      'nuxt_url_initial_bytes{url="/",compression="brotli"} 760',
      'nuxt_url_html_bytes{url="/",compression="brotli"} 120',
    ])
  })

  it('writes the size of other files only when the client build has some', () => {
    const data = run()
    delete data.chunks['font.woff2']
    expect(samples(renderMetrics(data, {
      groups: ['types'],
      compressions: ['brotli'],
    }))).toEqual([
      'nuxt_client_assets_bytes{type="js",compression="brotli"} 700',
      'nuxt_client_assets_bytes{type="css",compression="brotli"} 60',
    ])
  })

  it('writes each sample once, keeping the samples of each metric together after its HELP and TYPE', () => {
    const lines = renderMetrics(run(), {
      groups: ['totals', 'packages'],
      // As with `--compression=gzip,gzip,brotli`.
      compressions: ['gzip', 'gzip', 'brotli'],
    }).trimEnd().split('\n')
    expect(new Set(lines).size).toBe(lines.length)
    const typed: string[] = []
    for (const line of lines) {
      const type = /^# TYPE (\w+) gauge$/.exec(line)
      if (type) {
        expect(typed).not.toContain(type[1])
        typed.push(type[1]!)
      }
      else if (!line.startsWith('# HELP ')) {
        expect(line).toMatch(/^\w+\{(?:\w+="(?:[^"\\\n]|\\["\\n])*",?)+\} \d+$/)
        expect(line.slice(0, line.indexOf('{'))).toBe(typed.at(-1))
      }
    }
    expect(typed).toEqual(['nuxt_bundle_bytes', 'nuxt_bundle_origin_bytes', 'nuxt_package_bytes'])
  })

  it('sums each package\'s files in each build, with every compression, only when asked for', () => {
    expect(renderMetrics(run())).not.toContain('nuxt_package_bytes')
    expect(samples(renderMetrics(run(), {
      groups: ['packages'],
    }))).toEqual([
      'nuxt_package_bytes{bundle="client",package="@vueuse/core",compression="uncompressed"} 120',
      'nuxt_package_bytes{bundle="client",package="@vueuse/core",compression="gzip"} 60',
      'nuxt_package_bytes{bundle="client",package="@vueuse/core",compression="brotli"} 30',
      'nuxt_package_bytes{bundle="client",package="vue",compression="uncompressed"} 800',
      'nuxt_package_bytes{bundle="client",package="vue",compression="gzip"} 400',
      'nuxt_package_bytes{bundle="client",package="vue",compression="brotli"} 200',
      'nuxt_package_bytes{bundle="server",package="h3",compression="uncompressed"} 1200',
      'nuxt_package_bytes{bundle="server",package="h3",compression="gzip"} 600',
      'nuxt_package_bytes{bundle="server",package="h3",compression="brotli"} 300',
    ])
  })

  it('writes github-action-benchmark\'s custom format', () => {
    const text = renderMetrics(run(), {
      reporter: 'github-action-benchmark',
      groups: ['totals', 'routes'],
      compressions: ['gzip'],
    })
    expect(JSON.parse(text)).toEqual([
      { name: 'Client build (gzip)', unit: 'bytes', value: 600 },
      { name: 'Client build, app code (gzip)', unit: 'bytes', value: 80 },
      { name: 'Client build, dependencies (gzip)', unit: 'bytes', value: 460 },
      { name: 'Server build (gzip)', unit: 'bytes', value: 1800 },
      { name: 'Server build, app code (gzip)', unit: 'bytes', value: 200 },
      { name: 'Server build, dependencies (gzip)', unit: 'bytes', value: 600 },
      { name: 'Route / initial load (gzip)', unit: 'bytes', value: 1020 },
      { name: `Route ${TRICKY_ROUTE} initial load (gzip)`, unit: 'bytes', value: 500 },
    ])
  })
})
