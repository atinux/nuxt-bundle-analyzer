import type { Bundle, Part, RunData } from '../viewer/app/utils/data'

import { describe, expect, it } from 'vitest'

import { locationChanges, routeChanges } from '../viewer/app/utils/data'

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
