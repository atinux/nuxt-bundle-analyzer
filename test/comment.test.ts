import type { RunData } from '../viewer/app/utils/data'

import { describe, expect, it } from 'vitest'

import { renderComment } from '../src/comment'

/** A run with one chunk per route, each `brotli` bytes, and a client build of `total` bytes. */
function run(routes: Record<string, number>, total = 1000): RunData {
  const entries = Object.entries(routes)
  return {
    run: {
      name: 'run',
      slug: 'run',
      startTime: 0,
      endTime: 0,
      current: false,
    },
    bundles: {
      client: {
        uncompressed: total,
        gzip: total,
        brotli: total,
        sources: [],
        parts: [],
        assets: [],
        importers: new Map(),
        entries: new Set(),
        duplicates: new Map(),
        cycles: [],
      },
    },
    routes: entries.map(([path], index) => ({
      path,
      entries: [`_nuxt/${index}-${path.length}.js`],
    })),
    chunks: Object.fromEntries(entries.map(([path, brotli], index) => [
      `_nuxt/${index}-${path.length}.js`,
      {
        file: `_nuxt/${index}-${path.length}.js`,
        type: 'js',
        size: brotli,
        gzip: brotli,
        brotli,
        imports: [],
        dynamicImports: [],
        css: [],
      },
    ])),
  }
}

function routeLines(markdown: string) {
  return markdown.split('\n').filter(line => line.startsWith('| <code>'))
}

describe('renderComment', () => {
  it('lists the routes that changed by 100 B or more, the largest change first, with added and removed ones', () => {
    const markdown = renderComment(
      run({
        '/': 10_000,
        '/edge': 10_000,
        '/noise': 10_000,
        '/gone': 5000,
      }),
      run({
        '/': 9000,
        '/edge': 10_100,
        // Two builds of the same code differ by a few bytes.
        '/noise': 10_099,
        '/new': 20,
      }),
    )
    expect(routeLines(markdown)).toEqual([
      '| <code>/gone</code> | n/a | removed |',
      '| <code>/</code> | 9.00 kB | −1.00 kB (−10.0%) |',
      '| <code>/edge</code> | 10.1 kB | +100 B (+1.0%) |',
      // Added and removed routes are listed whatever their size.
      '| <code>/new</code> | 20 B | added |',
    ])
  })

  it('says no route changed when every change is under 100 B', () => {
    const markdown = renderComment(run({ '/': 10_000 }), run({ '/': 10_031 }))
    expect(routeLines(markdown)).toEqual([])
    expect(markdown).toContain('No route loads 100 B more or less before it renders.')
  })

  it('shows ten routes and counts the rest', () => {
    const routes = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`/page-${index}`, 100]))
    const grown = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`/page-${index}`, 100 + (index + 1) * 100]))
    const markdown = renderComment(run(routes), run(grown))
    expect(routeLines(markdown)).toHaveLength(10)
    expect(routeLines(markdown)[0]).toContain('/page-11')
    expect(markdown).toContain('And 2 more routes.')
  })

  it('colors the client total red when it grows and green when it shrinks', () => {
    expect(renderComment(run({}, 1000), run({}, 1100))).toContain('Client 1.10 kB $\\color{red}\\textsf{(+100 B, +10.0}\\\\%\\textsf{)}$')
    expect(renderComment(run({}, 1000), run({}, 900))).toContain('$\\color{green}\\textsf{(-100 B, -10.0}\\\\%\\textsf{)}$')
  })

  it('keeps names from the pull request from mentioning, linking, or breaking the table', () => {
    const name = '/@octocat|[x](https://example.com)`'
    const markdown = renderComment(run({ [name]: 100 }), run({ [name]: 300 }), { link: 'https://bundle.nuxt.dev/a) [b](https://example.com' })
    const [line] = routeLines(markdown)
    expect(line).toBe('| <code>/&#64;octocat&#124;&#91;x&#93;(https://example.com)&#96;</code> | 300 B | +200 B (+200.0%) |')
    expect(markdown).not.toContain('Explore the comparison')
  })

  it('leads with the comparison link', () => {
    const markdown = renderComment(run({}), run({}), { link: 'https://bundle.nuxt.dev/nuxt/ui/pull/1?view=compare&base=base&run=pr' })
    expect(markdown).toContain('**[Explore the comparison →](https://bundle.nuxt.dev/nuxt/ui/pull/1?view=compare&base=base&run=pr)**')
  })
})
