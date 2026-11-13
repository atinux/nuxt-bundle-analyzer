import { describe, expect, it } from 'vitest'

import { htmlAssets } from '../src/collect'

const app = { baseURL: '/', buildAssetsDir: '/_nuxt/' }

describe('htmlAssets', () => {
  it('lists each preloaded file once, and leaves out prefetches and the payload preload', () => {
    // The head of a page Nuxt prerenders, which preloads its entry and module-scripts it too.
    const html = [
      `<link rel="preload" as="fetch" crossorigin="anonymous" href="/chart/_payload.json?_b=6b2ddd5c">`,
      `<link rel="modulepreload" as="script" crossorigin href="/_nuxt/entry.js">`,
      `<link rel="modulepreload" as="script" crossorigin href="/_nuxt/chart.js">`,
      `<link rel="modulepreload" as="script" crossorigin href="/_nuxt/HeavyChart.js">`,
      `<script type="module" src="/_nuxt/entry.js" crossorigin></script>`,
      `<link rel="prefetch" as="style" crossorigin href="/_nuxt/error-404.BA7q62GH.css">`,
      `<link rel="prefetch" as="script" crossorigin href="/_nuxt/error-404.js">`,
      `<link rel="prefetch" as="script" crossorigin href="/_nuxt/docs.js">`,
    ].join('')
    expect(htmlAssets(html, app)).toEqual([
      '_nuxt/entry.js',
      '_nuxt/chart.js',
      '_nuxt/HeavyChart.js',
    ])
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
