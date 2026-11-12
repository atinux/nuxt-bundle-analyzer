import type { Nuxt, NuxtManifest, NuxtPage } from '@nuxt/schema'

import { Buffer } from 'node:buffer'
import { promises as fsp } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import { useLogger } from '@nuxt/kit'
import { join, relative } from 'pathe'

/** A client output file, keyed by its path in the client bundle (for example `_nuxt/entry.js`). */
interface AnalyzeChunk {
  file: string
  /** Source the chunk was built from, relative to `rootDir`. */
  src?: string
  type: 'js' | 'css' | 'asset'
  size: number
  gzip: number
  brotli: number
  isEntry?: boolean
  isDynamicEntry?: boolean
  imports: string[]
  dynamicImports: string[]
  css: string[]
}

interface AnalyzeRoute {
  path: string
  name?: string
  /** Chunks that are always loaded on this route: the app entry, its layout and every page in its chain. */
  entries: string[]
}

/** An HTML page Nitro prerendered, with the client files its HTML preloads. */
interface AnalyzePrerenderedPage {
  /** The URL Nitro prerendered, such as `/en/getting-started/installation`. */
  url: string
  /** The HTML document, as written to the public directory. */
  size: number
  gzip: number
  brotli: number
  /** Client JS and CSS the HTML preloads, as `chunks` keys. */
  files: string[]
}

/** What `nuxt.json` holds: the routes and the client chunks, next to Sonda's reports. */
export interface NuxtAnalyzeData {
  version: 1
  routes: AnalyzeRoute[]
  chunks: Record<string, AnalyzeChunk>
  /** Pages prerendered with `--prerender`, when there are any. */
  prerendered?: AnalyzePrerenderedPage[]
}

const CSS_RE = /\.css$/
const JS_RE = /\.m?js$/
const TAG_RE = /<(script|link)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi
const ATTR_RE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const logger = useLogger('nuxt-bundle-analyzer')

/**
 * The client files an HTML page preloads, as `chunks` keys such as `_nuxt/entry.js`: module scripts,
 * modulepreload and stylesheet links under `assetsDir`. Prefetch and the payload preload are left out.
 */
export function htmlAssets(html: string, assetsDir: string): string[] {
  const dir = `/${assetsDir.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/')
  const files = new Set<string>()
  for (const [, tag, attrs = ''] of html.matchAll(TAG_RE)) {
    const values: Record<string, string> = {}
    for (const [, name, double, single, bare] of attrs.matchAll(ATTR_RE)) {
      values[name!.toLowerCase()] = double ?? single ?? bare ?? ''
    }
    const rel = (values.rel ?? '').toLowerCase().split(/\s+/)
    const url = tag!.toLowerCase() === 'script'
      ? values.type?.toLowerCase() === 'module' && values.src
      : (rel.includes('modulepreload') || rel.includes('stylesheet')) && values.href
    if (!url) {
      continue
    }
    // `/_nuxt/x.js`, `/base/_nuxt/x.js` and `https://cdn/_nuxt/x.js` are all `_nuxt/x.js`.
    const path = `/${url.split(/[?#]/)[0]!.replace(/^(?:[a-z][\w+.-]*:)?\/\/[^/]*/i, '').replace(/^\/+/, '')}`
    const index = path.indexOf(dir)
    if (index !== -1) {
      files.add(path.slice(index + 1))
    }
  }
  return [...files]
}

/**
 * Registers the hooks that record the client manifest, the pages and the layouts,
 * and returns a function that turns them into {@link NuxtAnalyzeData} once the build is done.
 */
export function collectAnalyzeData(nuxt: Nuxt) {
  let pages: NuxtPage[] = []
  let layouts: Record<string, string> = {}
  let manifest: NuxtManifest | undefined
  let publicDir: string | undefined

  nuxt.hook('pages:resolved', (resolved) => {
    pages = resolved
  })
  nuxt.hook('app:resolve', (app) => {
    layouts = Object.fromEntries(Object.values(app.layouts).map(layout => [layout.name, layout.file]))
  })
  let prerendering = false
  const prerendered: AnalyzePrerenderedPage[] = []
  // Nitro serves the client build from its public directory; Nuxt 5 builds the client straight into it.
  nuxt.hook('nitro:init', (nitro) => {
    publicDir = nitro.options.output.publicDir
    // Nitro prerenders before the `compiled` hook writes `nuxt.json`.
    nitro.hooks.hook('prerender:init', () => {
      prerendering = true
    })
    nitro.hooks.hook('prerender:generate', (route: { route: string, contents?: string, contentType?: string, error?: unknown, skip?: boolean }) => {
      if (route.error || route.skip || !route.contentType?.includes('text/html') || typeof route.contents !== 'string') {
        return
      }
      // Only the sizes and the files are kept, not the HTML.
      const html = Buffer.from(route.contents)
      prerendered.push({
        url: route.route,
        size: html.byteLength,
        gzip: gzipSync(html).byteLength,
        brotli: brotliCompressSync(html).byteLength,
        files: htmlAssets(route.contents, nuxt.options.app.buildAssetsDir),
      })
    })
  })
  // Later hooks can still edit the manifest, so keep the reference and read it after the build.
  nuxt.hook('build:manifest', (built) => {
    manifest = built
  })

  return async (): Promise<NuxtAnalyzeData | undefined> => {
    if (!manifest) {
      return
    }
    const clientDirs = [
      publicDir,
      join(nuxt.options.buildDir, 'dist/client'),
    ].filter(dir => dir !== undefined)
    const assetsDir = nuxt.options.app.buildAssetsDir.replace(/^\/+|\/+$/g, '')
    const toFile = (file: string) => assetsDir
      ? `${assetsDir}/${file}`
      : file

    // Manifest keys are relative to the Vite root, which is `srcDir`.
    const keyByPath = new Map<string, string>()
    for (const key in manifest) {
      keyByPath.set(join(nuxt.options.srcDir, key), key)
    }
    const fileOf = (key: string) => manifest![key]?.file && toFile(manifest![key]!.file)

    const chunks: Record<string, AnalyzeChunk> = {}
    await Promise.all(Object.values(manifest).map(async (entry) => {
      if (!entry.file) {
        return
      }
      const file = toFile(entry.file)
      let contents: Buffer | undefined
      for (const dir of clientDirs) {
        contents ??= await fsp.readFile(join(dir, file)).catch(() => undefined)
      }
      chunks[file] = {
        file,
        src: entry.src && relative(nuxt.options.rootDir, join(nuxt.options.srcDir, entry.src)),
        type: CSS_RE.test(file)
          ? 'css'
          : JS_RE.test(file)
            ? 'js'
            : 'asset',
        size: contents?.byteLength ?? 0,
        gzip: contents
          ? gzipSync(contents).byteLength
          : 0,
        brotli: contents
          ? brotliCompressSync(contents).byteLength
          : 0,
        isEntry: entry.isEntry || undefined,
        isDynamicEntry: entry.isDynamicEntry || undefined,
        imports: (entry.imports || []).map(fileOf).filter(Boolean) as string[],
        dynamicImports: (entry.dynamicImports || []).map(fileOf).filter(Boolean) as string[],
        css: (entry.css || []).map(toFile),
      }
    }))

    const appEntries = Object.values(chunks).filter(chunk => chunk.isEntry).map(chunk => chunk.file)
    const chunkOf = (path: string) => {
      const key = keyByPath.get(path)
      return key
        ? fileOf(key)
        : undefined
    }

    const routes: AnalyzeRoute[] = []
    const visit = (page: NuxtPage, parents: string[], parentLayout: unknown) => {
      const own = page.file
        ? chunkOf(page.file)
        : undefined
      const chain = own
        ? [...parents, own]
        : parents
      // Vue Router merges `meta` from parent to child, so a child inherits its parent's layout.
      const inheritedLayout = page.meta?.layout ?? parentLayout
      if (!page.children?.length || page.children.every(child => child.path !== '')) {
        // `layout` is only known statically when `definePageMeta` sets it to a string.
        const layoutName = typeof inheritedLayout === 'string'
          ? inheritedLayout
          : inheritedLayout === false
            ? undefined
            : 'default'
        const layout = layoutName && layouts[layoutName]
          ? chunkOf(layouts[layoutName]!)
          : undefined
        routes.push({
          path: page.path,
          name: page.name,
          entries: [
            ...new Set([
              ...appEntries,
              ...layout
                ? [layout]
                : [],
              ...chain,
            ]),
          ],
        })
      }
      for (const child of page.children || []) {
        visit({
          ...child,
          path: child.path.startsWith('/')
            ? child.path
            : join(page.path, child.path),
        }, chain, inheritedLayout)
      }
    }
    for (const page of pages) {
      visit(page, [], undefined)
    }

    const pagesWithFiles = prerendered
      .map(page => ({
        ...page,
        files: page.files.filter(file => chunks[file]?.type === 'js' || chunks[file]?.type === 'css'),
      }))
      .sort((a, b) => a.url.localeCompare(b.url))
    // Such as a redirect page, which Nitro writes as HTML too.
    const dropped = pagesWithFiles.filter(page => page.files.length === 0)
    if (dropped.length > 0) {
      logger.info(`Left out ${dropped.length === 1
        ? '1 prerendered page'
        : `${dropped.length} prerendered pages`} that load no client file: ${dropped.map(page => page.url).join(', ')}.`)
    }
    const recorded = pagesWithFiles.filter(page => page.files.length > 0)
    if (prerendering) {
      logger.info(`Recorded ${recorded.length === 1
        ? '1 prerendered page'
        : `${recorded.length} prerendered pages`}.`)
    }

    return {
      version: 1,
      routes,
      chunks,
      ...recorded.length > 0 && { prerendered: recorded },
    }
  }
}
