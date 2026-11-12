import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { htmlAssets } from '../src/collect'

// The playground's pages as `--prerender --extends ./prerender-layer` writes them.
const chart = readFileSync(new URL('./fixtures/chart.html', import.meta.url), 'utf8')
const stats = readFileSync(new URL('./fixtures/stats.html', import.meta.url), 'utf8')

describe('htmlAssets', () => {
  it('lists the lazy component a page renders on the server, once for each file', () => {
    expect(htmlAssets(chart, '/_nuxt/')).toEqual([
      '_nuxt/entry.js',
      '_nuxt/nuxt.js',
      '_nuxt/runtime-core.esm-bundler.js',
      '_nuxt/error.js',
      '_nuxt/utils.js',
      '_nuxt/default.js',
      '_nuxt/AppHeader.js',
      '_nuxt/useCart.js',
      '_nuxt/chart.js',
      '_nuxt/HeavyChart.js',
    ])
  })

  it('leaves out what the HTML only prefetches and the payload preload', () => {
    // `/stats` shows the chart behind `v-if`, so its HTML only prefetches the chunk.
    expect(stats).toContain('<link rel="prefetch" as="script" crossorigin href="/_nuxt/HeavyChart.js">')
    expect(stats).toContain('_payload.json')
    const files = htmlAssets(stats, '/_nuxt/')
    expect(files).toContain('_nuxt/stats.js')
    expect(files).not.toContain('_nuxt/HeavyChart.js')
    expect(files.filter(file => file.includes('error-') || file.includes('payload'))).toEqual([])
  })

  it('keeps stylesheets and module scripts, and leaves out other scripts and links', () => {
    const html = [
      `<link rel="stylesheet" href="/_nuxt/entry.css">`,
      `<link rel="preload" as="style" href="/_nuxt/preload.css">`,
      `<link rel="prefetch stylesheet" href="/_nuxt/prefetched.css">`,
      `<link rel=modulepreload href=/_nuxt/unquoted.js>`,
      `<link href='/_nuxt/single.js' rel='modulepreload'>`,
      `<script src="/_nuxt/classic.js"></script>`,
      `<script type="importmap">{"imports":{"#entry":"/_nuxt/mapped.js"}}</script>`,
      `<script type="module" src="/_nuxt/module.js"></script>`,
    ].join('')
    expect(htmlAssets(html, '/_nuxt/')).toEqual([
      '_nuxt/entry.css',
      '_nuxt/prefetched.css',
      '_nuxt/unquoted.js',
      '_nuxt/single.js',
      '_nuxt/module.js',
    ])
  })

  it('names files by their chunk key, whatever the base URL or CDN, without the query', () => {
    const html = [
      `<link rel="modulepreload" href="/base/_nuxt/a.js">`,
      `<link rel="modulepreload" href="https://cdn.example.com/_nuxt/b.js?v=1#x">`,
      `<link rel="modulepreload" href="//cdn.example.com/_nuxt/a.js">`,
      `<link rel="modulepreload" href="/_nuxt-icons/c.js">`,
      `<link rel="modulepreload" href="/my_nuxt/d.js">`,
      `<link rel="modulepreload" href="https://_nuxt/e.js">`,
    ].join('')
    expect(htmlAssets(html, '/_nuxt/')).toEqual(['_nuxt/a.js', '_nuxt/b.js'])
    expect(htmlAssets(html.replaceAll('_nuxt/', 'assets/build/'), '/assets/build/')).toEqual(['assets/build/a.js', 'assets/build/b.js'])
  })
})
