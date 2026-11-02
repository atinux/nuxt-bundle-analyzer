#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveModulePath } from 'exsolve'
import { join, resolve } from 'pathe'

import bundleAnalyzer from './module'
import { defaultRunsDir, toSlug } from './runs'
import { serve } from './serve'
import { upload } from './upload'

const HELP = `Usage: nuxt-bundle-analyzer [command] [rootDir] [options]

Commands:
  analyze   Build the app with analysis and open the analyzer (default)
  serve     Open the analyzer on the runs already written
  upload    Send two runs to a hosted viewer from GitHub Actions

Options for analyze:
  --name <name>        Name of the run, to keep several and compare them (default: default)
  --no-serve           Write the reports without opening the analyzer
  --prerender          Prerender routes while analyzing
  --extends <layer>    Extend the app with a layer, as with nuxi (repeatable)
  --log-level <level>  silent, info or verbose

Options for analyze and serve:
  --port <port>          Port of the analyzer (default: PORT or 3000)
  --allowed-host <host>  Also answer this host, such as a tunnel; a leading dot allows subdomains (repeatable)

Options for upload:
  --runs <dir>     Directory with one directory per run (default: node_modules/.cache/nuxt-bundle-analyzer)
  --base <name>    Run to compare against (default: base)
  --head <name>    Run with the change (default: pr)
  --pr <number>    Pull request the comparison is for
  --url <url>      Hosted viewer (default: NUXT_BUNDLE_ANALYZER_URL)
  --sha <sha>      Commit the head run was built from
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'name': { type: 'string', default: 'default' },
    'serve': { type: 'boolean', default: true },
    'no-serve': { type: 'boolean' },
    'prerender': { type: 'boolean', default: false },
    'extends': { type: 'string', multiple: true, default: [] },
    'log-level': { type: 'string' },
    'logLevel': { type: 'string' },
    'port': { type: 'string' },
    'allowed-host': { type: 'string', multiple: true, default: [] },
    'runs': { type: 'string' },
    'base': { type: 'string', default: 'base' },
    'head': { type: 'string', default: 'pr' },
    'pr': { type: 'string' },
    'url': { type: 'string' },
    'sha': { type: 'string' },
    'help': { type: 'boolean', short: 'h' },
  },
})

const COMMANDS = ['analyze', 'serve', 'upload']
const command = COMMANDS.includes(positionals[0] ?? '')
  ? positionals.shift()!
  : 'analyze'
const rootDir = resolve(positionals[0] ?? '.')
const runsDir = values.runs
  ? resolve(values.runs)
  : defaultRunsDir(rootDir)
const uiDir = fileURLToPath(new URL('./ui/', import.meta.url))

/** The `@nuxt/kit` of the project's Nuxt, so the build uses the versions the project does. */
async function loadKit(): Promise<typeof import('@nuxt/kit')> {
  const nuxtDir = resolveModulePath('nuxt/package.json', {
    from: join(rootDir, '/'),
    try: true,
  })
  const kit = resolveModulePath('@nuxt/kit', {
    from: [
      join(rootDir, '/'),
      ...nuxtDir
        ? [nuxtDir]
        : [],
    ],
    try: true,
  })
  return kit
    ? import(pathToFileURL(kit).href)
    : import('@nuxt/kit')
}

async function analyze() {
  process.env.NODE_ENV = 'production'
  const kit = await loadKit()
  const nuxt = await kit.loadNuxt({
    cwd: rootDir,
    ready: false,
    overrides: {
      ...(values.extends.length > 0 && { extends: values.extends }),
      ...((values['log-level'] ?? values.logLevel) && { logLevel: (values['log-level'] ?? values.logLevel) as 'info' }),
      // Sonda replaces the reports `build.analyze` adds, and DevTools adds `vite-plugin-inspect` with it.
      build: { analyze: false },
      modules: [bundleAnalyzer],
      bundleAnalyzer: { enabled: true, name: values.name },
      ...(!values.prerender && {
        nitro: {
          prerender: {
            routes: [],
            crawlLinks: false,
            ignore: [
              () => true,
            ],
          },
        },
      }),
    } as Parameters<typeof kit.loadNuxt>[0]['overrides'],
  })
  if (!values.prerender) {
    // Prerendering runs the built app, and its output is not what is measured.
    nuxt.hook('nitro:init', (nitro) => {
      nitro.hooks.hook('prerender:routes', (routes: Set<string>) => routes.clear())
    })
  }
  await nuxt.ready()
  await kit.buildNuxt(nuxt)
  await nuxt.close()
}

async function open() {
  const url = await serve({
    runsDir,
    uiDir,
    port: Number(values.port ?? process.env.PORT ?? 3000),
    hostname: process.env.HOST || 'localhost',
    allowedHosts: values['allowed-host'],
    current: command === 'analyze'
      ? toSlug(values.name)
      : undefined,
  })
  console.log(`\n  Bundle analyzer: ${url}\n`)
}

async function main() {
  if (values.help) {
    console.log(HELP)
    return
  }
  if (command === 'upload') {
    const url = values.url ?? process.env.NUXT_BUNDLE_ANALYZER_URL
    const pull = Number(values.pr)
    if (!url || !Number.isSafeInteger(pull) || pull <= 0) {
      throw new Error('upload needs --url (or NUXT_BUNDLE_ANALYZER_URL) and --pr <number>.')
    }
    const link = await upload({
      runsDir,
      base: values.base,
      head: values.head,
      pull,
      url,
      sha: values.sha,
    })
    console.log(link)
    // In GitHub Actions, later steps read the link as `steps.<id>.outputs.url`.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `url=${link}\n`)
    }
    return
  }
  if (command === 'analyze') {
    await analyze()
  }
  if (command === 'serve' || (values.serve && !values['no-serve'] && !process.env.CI)) {
    await open()
  }
}

main().catch((error) => {
  console.error(error instanceof Error
    ? error.message
    : error)
  process.exit(1)
})
