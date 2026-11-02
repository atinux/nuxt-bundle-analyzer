import type { Nuxt } from '@nuxt/schema'

import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { defineNuxtModule, useLogger } from '@nuxt/kit'
import { join, relative, resolve } from 'pathe'
import { SondaRollupPlugin, SondaVitePlugin, SondaWebpackPlugin } from 'sonda'

import { collectAnalyzeData } from './collect'
import { defaultRunsDir, RUN_FILES, toSlug } from './runs'

export interface ModuleOptions {
  /**
   * Measure the build. Defaults to on when `build.analyze` is, as `nuxi analyze` turns it on,
   * so a regular `nuxt build` is left alone.
   */
  enabled?: boolean
  /** Name of the run, to keep several and compare them. */
  name: string
  /** Where runs are kept. Defaults to `node_modules/.cache/nuxt-bundle-analyzer`. */
  runsDir?: string
}

/** What each run records about itself in `meta.json`. */
export interface RunMeta {
  name: string
  slug: string
  startTime: number
  endTime: number
}

const logger = useLogger('nuxt-bundle-analyzer')

function isAnalyzing(nuxt: Nuxt) {
  const analyze = nuxt.options.build.analyze
  return analyze === true || (typeof analyze === 'object' && analyze.enabled === true)
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-bundle-analyzer',
    configKey: 'bundleAnalyzer',
  },
  defaults: {
    name: process.env.NUXT_BUNDLE_ANALYZER_NAME || 'default',
  },
  setup(options, nuxt) {
    if (nuxt.options.dev || nuxt.options._prepare || !(options.enabled ?? isAnalyzing(nuxt))) {
      return
    }
    // The command adds the module too, so a project that lists it is measured once.
    const state = nuxt as Nuxt & { _bundleAnalyzer?: true }
    if (state._bundleAnalyzer) {
      return
    }
    state._bundleAnalyzer = true

    const startTime = Date.now()
    const slug = toSlug(options.name)
    const runDir = join(resolve(nuxt.options.rootDir, options.runsDir ?? defaultRunsDir(nuxt.options.rootDir)), slug)

    // Sonda measures the final, minified output through its source maps. Hidden source maps
    // leave no `sourceMappingURL` comment in the built files.
    nuxt.options.sourcemap = { ...nuxt.options.sourcemap, client: 'hidden', server: true }
    // Nitro empties the source maps of files made only of dependencies, which Sonda needs to break them down.
    // Nuxt's schema leaves Nitro's options open unless `@nuxt/nitro-server` augments it.
    nuxt.options.nitro.experimental = { ...nuxt.options.nitro.experimental, sourcemapMinify: false } as typeof nuxt.options.nitro.experimental
    // Reads the `layout` a page sets with `definePageMeta` at build time, so `nuxt.json` knows
    // which layout each route loads.
    nuxt.options.experimental.extraPageMetaExtractionKeys = [
      ...new Set([
        ...nuxt.options.experimental.extraPageMetaExtractionKeys ?? [],
        'layout',
      ]),
    ]
    // Chunks named after what they hold, such as `_nuxt/stats.js`, read better than hashes.
    const build = (nuxt.options.vite.build ??= {})
    const rollupOptions = (build.rollupOptions ??= {})
    if (!Array.isArray(rollupOptions.output)) {
      rollupOptions.output = { ...rollupOptions.output, chunkFileNames: '_nuxt/[name].js', entryFileNames: '_nuxt/[name].js' }
    }

    const sondaOptions = (filename: string) => ({
      outputDir: runDir,
      filename,
      format: ['json' as const],
      open: false as const,
      gzip: true,
      brotli: true,
    })

    nuxt.hook('vite:extendConfig', (config, { isClient }) => {
      if (!isClient) {
        return
      }
      // With Nuxt 5, the client and server environments share this list of plugins, so it is
      // extended in place and the plugin limits itself to the client environment.
      const plugin = SondaVitePlugin(sondaOptions('client'))
      config.plugins?.push({
        ...plugin,
        applyToEnvironment: (environment: { name: string }) => environment.name === 'client',
      } as typeof plugin)
    })
    for (const builder of ['webpack', 'rspack'] as const) {
      nuxt.hook(`${builder}:config`, (configs: { name?: string, plugins?: unknown[] }[]) => {
        configs.find(config => config.name === 'client')?.plugins?.push(new SondaWebpackPlugin(sondaOptions('client')))
      })
    }

    const collect = collectAnalyzeData(nuxt)

    nuxt.hook('build:before', async () => {
      await fsp.rm(runDir, { recursive: true, force: true })
    })

    nuxt.hook('nitro:init', (nitro) => {
      nitro.hooks.hook('rollup:before', async (_nitro: unknown, config: { plugins?: unknown }) => {
        const plugins = ([await config.plugins] as unknown[]).flat(Infinity).filter(Boolean)
        // `deep` follows the source maps of the Vue server build that Nitro bundles, so its components are listed too.
        const plugin = SondaRollupPlugin({
          ...sondaOptions('nitro'),
          deep: true,
        })
        // Sonda writes its report in `closeBundle`, which Nitro v2 never triggers as it does not
        // close its Rollup build, so the report is written right after the bundle instead.
        const report = {
          ...plugin,
          async writeBundle(this: unknown, ...args: unknown[]) {
            await (plugin.writeBundle as ((...args: unknown[]) => Promise<void>) | undefined)?.apply(this, args)
            await (plugin.closeBundle as (() => Promise<void>) | undefined)?.apply(this, [])
          },
          closeBundle: undefined,
        }
        config.plugins = [...plugins, report] as typeof config.plugins
      })

      // Nitro has built the server and copied the client build into its public directory.
      nitro.hooks.hook('compiled', async () => {
        await fsp.mkdir(runDir, { recursive: true })
        const data = await collect()
        if (data) {
          await fsp.writeFile(join(runDir, 'nuxt.json'), JSON.stringify(data))
        }
        const meta: RunMeta = {
          name: options.name,
          slug,
          startTime,
          endTime: Date.now(),
        }
        await fsp.writeFile(join(runDir, 'meta.json'), JSON.stringify(meta, null, 2))
        const written = (await fsp.readdir(runDir)).filter(file => RUN_FILES.includes(file))
        logger.success(`Bundle analysis \`${options.name}\` written to \`${relative(process.cwd(), runDir) || '.'}\` (${written.join(', ')}).`)
      })
    })
  },
})
