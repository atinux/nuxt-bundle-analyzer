import type { Bundle, Part, RunData } from '../viewer/app/utils/data'

import { describe, expect, it } from 'vitest'

import { clientChunks, locationChanges, normalizeId, packageOf, pageChanges, pages, prerenderedPages, routeChanges } from '../viewer/app/utils/data'

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
    prerendered: [],
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

describe('pageChanges', () => {
  it('shows the lazy chunk a prerendered URL preloads growing, which its route does not load', () => {
    const grown = run('pr', [
      part('.nuxt/dist/client/_nuxt/stats.js', 'app/pages/stats.vue', 100),
      part('.nuxt/dist/client/_nuxt/HeavyChart.js', 'node_modules/fast-check/lib/fast-check.js', 5200, 'fast-check'),
    ], { '_nuxt/entry.js': 300, '_nuxt/stats.js': 100, '_nuxt/HeavyChart.js': 5200 })
    const page = {
      url: '/stats',
      size: 2000,
      gzip: 700,
      brotli: 600,
      files: ['_nuxt/entry.js', '_nuxt/stats.js', '_nuxt/HeavyChart.js'],
    }
    const before = {
      ...base,
      prerendered: [page],
    }
    const after = {
      ...grown,
      prerendered: [page],
    }
    expect(pageChanges(before, after, '/stats', 'gzip')).toEqual({
      chunks: [
        {
          key: '_nuxt/HeavyChart.js',
          base: 5000,
          current: 5200,
          delta: 200,
        },
      ],
      sources: [
        {
          key: 'node_modules/fast-check',
          base: 5000,
          current: 5200,
          delta: 200,
        },
      ],
    })
    expect(routeChanges(before, after, '/stats', 'gzip').chunks).toEqual([])
  })
})

describe('prerenderedPages', () => {
  /** A Docus-like site: a landing page and a catch-all docs page, copied for `en` and `fr`. */
  function site() {
    const data = run('pr', [], {
      '_nuxt/entry.js': 3000,
      '_nuxt/default.js': 200,
      '_nuxt/docs.js': 150,
      '_nuxt/landing.js': 70,
      '_nuxt/slug.js': 90,
      '_nuxt/shared.js': 40,
      '_nuxt/prose.js': 500,
      '_nuxt/prose.css': 30,
      '_nuxt/hero.js': 800,
    })
    const chunks = data.chunks
    chunks['_nuxt/entry.js']!.isEntry = true
    chunks['_nuxt/default.js']!.src = 'layer/app/layouts/default.vue'
    chunks['_nuxt/docs.js']!.src = 'layer/app/layouts/docs.vue'
    chunks['_nuxt/landing.js']!.src = 'layer/app/templates/landing.vue'
    chunks['_nuxt/slug.js']!.src = 'layer/app/pages/[[lang]]/[...slug].vue'
    chunks['_nuxt/prose.js']!.src = 'node_modules/@nuxt/ui/dist/runtime/components/prose/Callout.vue'
    chunks['_nuxt/hero.js']!.src = 'node_modules/@nuxt/ui/dist/runtime/components/PageHero.vue'
    chunks['_nuxt/prose.css']!.type = 'css'
    chunks['_nuxt/prose.js']!.css = ['_nuxt/prose.css']
    // The docs page imports a chunk statically, which its HTML preloads too.
    chunks['_nuxt/slug.js']!.imports = ['_nuxt/shared.js']
    chunks['_nuxt/slug.js']!.dynamicImports = ['_nuxt/prose.js']
    chunks['_nuxt/landing.js']!.dynamicImports = ['_nuxt/hero.js']
    // The `en` routes come first, so picking the first candidate would give `fr` URLs the `en` route.
    data.routes = ['en', 'fr'].flatMap(locale => [
      {
        path: `/${locale}/:lang?`,
        entries: ['_nuxt/entry.js', '_nuxt/default.js', '_nuxt/landing.js'],
      },
      {
        path: `/${locale}/:lang?/:slug(.*)*`,
        entries: ['_nuxt/entry.js', '_nuxt/docs.js', '_nuxt/slug.js'],
      },
    ])
    const docs = [
      '_nuxt/entry.js',
      '_nuxt/docs.js',
      '_nuxt/slug.js',
      '_nuxt/shared.js',
      '_nuxt/prose.js',
      '_nuxt/prose.css',
    ]
    const page = (url: string, files: string[]) => ({
      url,
      size: 9000,
      gzip: 3000,
      brotli: 2500,
      files,
    })
    data.prerendered = [
      page('/en', [
        '_nuxt/entry.js',
        '_nuxt/default.js',
        '_nuxt/landing.js',
        '_nuxt/hero.js',
      ]),
      page('/fr/guide', docs),
      page('/en/guide', docs),
      // A page whose layout is set at runtime, so the HTML loads another layout than its route guessed.
      page('/en/other', [
        '_nuxt/entry.js',
        '_nuxt/default.js',
        '_nuxt/slug.js',
        '_nuxt/shared.js',
      ]),
      // An SPA shell renders no page.
      page('/200.html', ['_nuxt/entry.js']),
    ]
    return prerenderedPages(data, clientChunks(data))
  }
  const byUrl = (url: string) => site().find(page => page.url === url)!

  it('picks the route whose page the HTML loads, and the locale copy the URL is in', () => {
    expect(site().map(page => [page.url, page.route?.path, page.page?.src])).toEqual([
      // The catch-all also matches `/en`, but the HTML loads the landing page, not the docs page.
      ['/en', '/en/:lang?', 'layer/app/templates/landing.vue'],
      ['/fr/guide', '/fr/:lang?/:slug(.*)*', 'layer/app/pages/[[lang]]/[...slug].vue'],
      ['/en/guide', '/en/:lang?/:slug(.*)*', 'layer/app/pages/[[lang]]/[...slug].vue'],
      ['/en/other', '/en/:lang?/:slug(.*)*', 'layer/app/pages/[[lang]]/[...slug].vue'],
      ['/200.html', undefined, undefined],
    ])
  })

  it('adds what the HTML preloads beyond the route graph, each chunk with its stylesheet', () => {
    const page = byUrl('/fr/guide')
    // `shared.js` is preloaded too, but the docs page imports it statically.
    expect(page.added.map(file => [file.file, file.gzip])).toEqual([
      ['_nuxt/prose.js', 530],
    ])
    expect(page.addedSize.gzip).toBe(530)
    expect(page.routeInitial?.gzip).toBe(3000 + 150 + 90 + 40)
    expect(page.initial.gzip).toBe(3000 + 150 + 90 + 40 + 530)
    expect(page.notLoaded).toEqual([])
    expect(byUrl('/en').added.map(file => file.chunk?.src)).toEqual(['@nuxt/ui/dist/runtime/components/PageHero.vue'])
  })

  it('lists what the route loads and the HTML does not, so the sizes add up', () => {
    const page = byUrl('/en/other')
    expect(page.notLoaded.map(file => file.file)).toEqual(['_nuxt/docs.js'])
    expect(page.added.map(file => file.file)).toEqual(['_nuxt/default.js'])
    expect(page.routeInitial!.gzip + page.addedSize.gzip - 150).toBe(page.initial.gzip)
  })

  it('compares an SPA shell with no route', () => {
    const page = byUrl('/200.html')
    expect(page.added).toEqual([])
    expect(page.files.map(file => file.file)).toEqual(['_nuxt/entry.js'])
    expect(page.initial.gzip).toBe(3000)
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
