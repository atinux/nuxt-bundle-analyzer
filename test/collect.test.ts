import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { htmlAssets } from '../src/collect'

const app = { baseURL: '/', buildAssetsDir: '/_nuxt/' }

// The playground's pages as `--prerender --extends ./prerender-layer` writes them.
const chart = readFileSync(new URL('./fixtures/chart.html', import.meta.url), 'utf8')
const stats = readFileSync(new URL('./fixtures/stats.html', import.meta.url), 'utf8')

describe('htmlAssets', () => {
  it('lists the lazy component a page renders on the server, once for each file', () => {
    expect(htmlAssets(chart, app)).toEqual([
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
    const files = htmlAssets(stats, app)
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
      // Markup the browser doesn't load: a comment, and tags in the contents of a script or a style.
      `<!-- <link rel="modulepreload" href="/_nuxt/commented.js"> -->`,
      `<script>document.write('<link rel="modulepreload" href="/_nuxt/in-script.js">')</script>`,
      `<style>/* <link rel="stylesheet" href="/_nuxt/in-style.css"> */</style>`,
      `<script type="module" src="/_nuxt/after.js"></script>`,
    ].join('')
    expect(htmlAssets(html, app)).toEqual([
      '_nuxt/entry.css',
      '_nuxt/prefetched.css',
      '_nuxt/unquoted.js',
      '_nuxt/single.js',
      '_nuxt/module.js',
      '_nuxt/after.js',
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
    expect(htmlAssets(html, app)).toEqual(['_nuxt/a.js', '_nuxt/b.js'])
    expect(htmlAssets(html.replaceAll('_nuxt/', 'assets/build/'), { baseURL: '/', buildAssetsDir: '/assets/build/' })).toEqual(['assets/build/a.js', 'assets/build/b.js'])
  })

  it('leaves out the base URL and the CDN path when the build assets are at the root', () => {
    const html = `<script type="module" src="/base/entry.js"></script><link rel="stylesheet" href="https://cdn.example.com/site/entry.css">`
    expect(htmlAssets(html, { baseURL: '/base/', buildAssetsDir: '/' })).toEqual(['entry.js', 'site/entry.css'])
    expect(htmlAssets(html, { baseURL: '/base/', buildAssetsDir: '/', cdnURL: 'https://cdn.example.com/site/' })).toEqual(['entry.js', 'entry.css'])
  })
})
