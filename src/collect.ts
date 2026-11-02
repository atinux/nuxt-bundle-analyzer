import type { Nuxt, NuxtManifest, NuxtPage } from '@nuxt/schema'

import type { Buffer } from 'node:buffer'

import { promises as fsp } from 'node:fs'
import { brotliCompressSync, gzipSync } from 'node:zlib'
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

/** What `nuxt.json` holds: the routes and the client chunks, next to Sonda's reports. */
export interface NuxtAnalyzeData {
  version: 1
  routes: AnalyzeRoute[]
  chunks: Record<string, AnalyzeChunk>
}

const CSS_RE = /\.css$/
const JS_RE = /\.m?js$/

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
  // Nitro serves the client build from its public directory; Nuxt 5 builds the client straight into it.
  nuxt.hook('nitro:init', (nitro) => {
    publicDir = nitro.options.output.publicDir
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

    return { version: 1, routes, chunks }
  }
}
