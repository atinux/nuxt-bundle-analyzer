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
    prerendered: [],
  }
}

function routeLines(markdown: string) {
  return markdown.split('\n').filter(line => line.startsWith('| <code>'))
}

/** Adds prerendered URLs to a run, each preloading one chunk of `initial` bytes, with `html` bytes of HTML. */
function prerender(data: RunData, urls: Record<string, [initial: number, html: number]>): RunData {
  for (const [url, [initial, html]] of Object.entries(urls)) {
    const file = `_nuxt/url-${url}.js`
    data.chunks[file] = {
      file,
      type: 'js',
      size: initial,
      gzip: initial,
      brotli: initial,
      imports: [],
      dynamicImports: [],
      css: [],
    }
    data.prerendered.push({
      url,
      size: html,
      gzip: html,
      brotli: html,
      files: [file],
    })
  }
  return data
}

/** The rows of the prerendered URLs' table. */
function urlLines(markdown: string) {
  const lines = markdown.split('\n')
  const start = lines.indexOf('| Prerendered URL | Initial load | Δ | HTML | Δ |')
  if (start === -1) {
    return []
  }
  const end = lines.findIndex((line, index) => index > start && !line.startsWith('|'))
  return lines.slice(start + 2, end)
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

  it('lists the prerendered URLs whose initial load or HTML changed by 100 B or more, with added and removed ones', () => {
    const markdown = renderComment(
      prerender(run({}), {
        '/a': [10_000, 2000],
        '/b': [4000, 3000],
        '/c': [4000, 3000],
        '/gone': [5000, 1000],
      }),
      prerender(run({}), {
        '/a': [10_500, 2000],
        // Only the HTML grew.
        '/b': [4000, 3200],
        '/c': [4099, 3050],
        '/new': [300, 1000],
      }),
    )
    expect(urlLines(markdown)).toEqual([
      '| <code>/gone</code> | n/a | removed | n/a | removed |',
      '| <code>/a</code> | 10.5 kB | +500 B (+5.0%) | 2.00 kB | ±0 B |',
      '| <code>/new</code> | 300 B | added | 1.00 kB | added |',
      '| <code>/b</code> | 4.00 kB | ±0 B | 3.20 kB | +200 B (+6.7%) |',
    ])
    expect(markdown).toContain('Prerendered URLs count the JavaScript and CSS their HTML preloads')
  })

  it('says no prerendered URL changed when every change is under 100 B, and leaves the table out without any', () => {
    const markdown = renderComment(prerender(run({}), {
      '/a': [1000, 1000],
    }), prerender(run({}), {
      '/a': [1099, 1099],
    }))
    expect(urlLines(markdown)).toEqual([])
    expect(markdown).toContain('No prerendered URL preloads 100 B more or less.')
    const without = renderComment(run({ '/': 1000 }), run({ '/': 2000 }))
    expect(without).not.toContain('Prerendered URL')
    expect(without).not.toContain('prerendered URL')
  })

  it('keeps prerendered URLs from mentioning, linking, or breaking the table', () => {
    const url = '/@octocat|[x](https://example.com)`'
    const markdown = renderComment(prerender(run({}), {
      [url]: [100, 100],
    }), prerender(run({}), {
      [url]: [300, 100],
    }))
    expect(urlLines(markdown)).toEqual(['| <code>/&#64;octocat&#124;&#91;x&#93;(https://example.com)&#96;</code> | 300 B | +200 B (+200.0%) | 100 B | ±0 B |'])
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
