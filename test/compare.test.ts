import type { Bundle, Part, RunData } from '../viewer/app/utils/data'

import { describe, expect, it } from 'vitest'

import { clientChunks, locationChanges, normalizeId, packageOf, pages, routeChanges } from '../viewer/app/utils/data'

function part(asset: string, id: string, gzip: number, pkg?: string): Part {
  return {
    id,
    package: pkg,
    asset,
    uncompressed: gzip * 3,
    gzip,
    brotli: gzip,
  }
}

/** A run with one route, `/stats`, loading `entry.js` and `stats.js`, built in `dir`. */
function run(dir: string, parts: Part[], chunks: Record<string, number>): RunData {
  const bundle = {
    parts,
    sources: [],
    assets: [],
    uncompressed: 0,
    gzip: 0,
    brotli: 0,
  } as unknown as Bundle
  return {
    run: {
      name: dir,
      slug: dir,
      startTime: 0,
      endTime: 0,
      current: false,
    },
    bundles: { client: bundle },
    routes: [
      {
        path: '/stats',
        entries: ['_nuxt/entry.js', '_nuxt/stats.js'],
      },
    ],
    chunks: Object.fromEntries(Object.entries(chunks).map(([file, gzip]) => [
      file,
      {
        file,
        type: 'js',
        size: gzip * 3,
        gzip,
        brotli: gzip,
        imports: [],
        dynamicImports: [],
        css: [],
      },
    ])),
  }
}

// CI often builds the base commit in another directory, so Sonda names its files differently.
const base = run('base', [
  part('.bundle-base/.nuxt/dist/client/_nuxt/stats.js', 'app/pages/stats.vue', 100),
  part('.bundle-base/.nuxt/dist/client/_nuxt/HeavyChart.js', 'node_modules/fast-check/lib/fast-check.js', 5000, 'fast-check'),
], { '_nuxt/entry.js': 300, '_nuxt/stats.js': 100, '_nuxt/HeavyChart.js': 5000 })
const current = run('pr', [
  part('.nuxt/dist/client/_nuxt/stats.js', 'app/pages/stats.vue', 110),
  part('.nuxt/dist/client/_nuxt/stats.js', 'node_modules/fast-check/lib/fast-check.js', 5000, 'fast-check'),
], { '_nuxt/entry.js': 300, '_nuxt/stats.js': 5110 })

describe('locationChanges', () => {
  it('shows a package moving to another chunk, whatever directory each run was built in', () => {
    expect(locationChanges(base, current, 'client', { kind: 'package', id: 'fast-check' }, 'gzip')).toEqual([
      {
        key: '_nuxt/HeavyChart.js',
        base: 5000,
        current: undefined,
        delta: -5000,
      },
      {
        key: '_nuxt/stats.js',
        base: undefined,
        current: 5000,
        delta: 5000,
      },
    ])
  })
})

describe('routeChanges', () => {
  it('lists the chunks and the sources in them that changed, leaving out the chunk that did not', () => {
    const changes = routeChanges(base, current, '/stats', 'gzip')
    expect(changes.chunks).toEqual([
      {
        key: '_nuxt/stats.js',
        base: 100,
        current: 5110,
        delta: 5010,
      },
    ])
    // The package was in a chunk the route only loads on demand, so it is new to the route.
    expect(changes.sources).toEqual([
      {
        key: 'node_modules/fast-check',
        base: undefined,
        current: 5000,
        delta: 5000,
      },
      {
        key: 'app/pages/stats.vue',
        base: 100,
        current: 110,
        delta: 10,
      },
    ])
  })
})

describe('pages', () => {
  it('leaves out the async data handlers Nuxt extracts next to a page', () => {
    const data = run('pr', [], { '_nuxt/entry.js': 300, '_nuxt/stats.js': 100, '_nuxt/async-data-chunk-0.js': 40 })
    data.chunks['_nuxt/stats.js']!.src = 'app/pages/stats.vue'
    data.chunks['_nuxt/stats.js']!.dynamicImports = ['_nuxt/async-data-chunk-0.js']
    data.chunks['_nuxt/async-data-chunk-0.js']!.src = 'app/pages/async-data-chunk-0.js'
    const list = pages(data, clientChunks(data))
    expect(list.map(page => page.file)).toEqual(['app/pages/stats.vue'])
    expect(list[0]!.lazy.map(chunk => chunk.kind)).toEqual(['asyncData'])
  })

  it('names a page above the project root the way Sonda does, so its details are found', () => {
    const data = run('pr', [], { '_nuxt/entry.js': 300, '_nuxt/stats.js': 100 })
    // What the collector writes when `srcDir` sits outside `rootDir`.
    data.chunks['_nuxt/stats.js']!.src = '../app/pages/stats.vue'
    expect(pages(data, clientChunks(data)).map(page => page.file)).toEqual(['app/pages/stats.vue'])
  })

  it('lists the pages routes render from outside `pages/`, and keeps their layout a layout', () => {
    const data = run('pr', [], {
      '_nuxt/entry.js': 300,
      '_nuxt/default.js': 50,
      '_nuxt/landing.js': 20,
      '_nuxt/slug.js': 30,
    })
    data.chunks['_nuxt/entry.js']!.isEntry = true
    data.chunks['_nuxt/default.js']!.src = 'layer/app/layouts/default.vue'
    // Docus adds its landing page with `extendPages`.
    data.chunks['_nuxt/landing.js']!.src = 'layer/app/templates/landing.vue'
    // A site extending Docus from npm renders its pages from `node_modules`.
    data.chunks['_nuxt/slug.js']!.src = 'node_modules/docus/app/pages/[...slug].vue'
    data.routes = [
      {
        path: '/',
        entries: ['_nuxt/entry.js', '_nuxt/default.js', '_nuxt/landing.js'],
      },
      {
        path: '/:slug(.*)*',
        entries: ['_nuxt/entry.js', '_nuxt/default.js', '_nuxt/slug.js'],
      },
      // A route without a page file lists the layout last.
      {
        path: '/sitemap.xml',
        entries: ['_nuxt/entry.js', '_nuxt/default.js'],
      },
    ]
    const chunks = clientChunks(data)
    expect(pages(data, chunks).map(page => [page.file, page.route])).toEqual([
      ['docus/app/pages/[...slug].vue', '/:slug(.*)*'],
      ['layer/app/templates/landing.vue', '/'],
    ])
    expect(chunks.find(chunk => chunk.file === '_nuxt/default.js')!.kind).toBe('layout')
  })
})

describe('normalizeId', () => {
  // Names as Sonda gives them for nuxt.com, whose build directory is `node_modules/.cache/nuxt/.nuxt`.
  const buildDir = 'node_modules/.cache/nuxt/.nuxt'

  it('names a dependency inside the build directory after its package, not `.pnpm`', () => {
    const id = normalizeId(`${buildDir}/node_modules/.pnpm/@ai-sdk+provider@4.0.35/node_modules/@ai-sdk/provider/dist/index.js`)
    expect(id).toBe('node_modules/@ai-sdk/provider/dist/index.js')
    expect(packageOf(id)).toBe('@ai-sdk/provider')
  })

  it('keeps the project files and the files Nuxt generates apart', () => {
    expect(normalizeId(`${buildDir}/app/pages/index.vue`)).toBe('app/pages/index.vue')
    expect(normalizeId(`${buildDir}/dist/client/_nuxt/entry.js`)).toBe('.nuxt/dist/client/_nuxt/entry.js')
  })
})
