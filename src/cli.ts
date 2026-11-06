#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { resolveModulePath } from 'exsolve'
import { join, resolve } from 'pathe'

import { readRunData, renderComment } from './comment'
import { findPullRequest, postComment } from './github'
import bundleAnalyzer from './module'
import { defaultRunsDir, toSlug } from './runs'
import { serve } from './serve'
import { readCommit, upload } from './upload'

const HELP = `Usage: nuxt-bundle-analyzer [command] [rootDir] [options]

Commands:
  analyze   Build the app with analysis and open the analyzer (default)
  serve     Open the analyzer on the runs already written
  upload    Send runs to a hosted viewer from GitHub Actions
  comment   Write a pull request comment comparing two runs, in Markdown

Options for analyze:
  --name <name>        Name of the run, to keep several and compare them (default: default)
  --no-serve           Write the reports without opening the analyzer
  --prerender          Prerender routes while analyzing
  --extends <layer>    Extend the app with a layer, as with nuxi (repeatable)
  --log-level <level>  silent, info or verbose

Options for analyze and serve:
  --port <port>          Port of the analyzer (default: PORT or 3000)
  --allowed-host <host>  Also answer this host, such as a tunnel; a leading dot allows subdomains (repeatable)

Options for upload and comment:
  --runs <dir>      Directory with one directory per run (default: node_modules/.cache/nuxt-bundle-analyzer)
  --base <name>     Run to compare against (default: base)
  --head <name>     Run with the change (default: pr)
  --pr <number>     Pull request the comparison is for (default: the one of the GitHub Actions
                    event, also from a workflow_run workflow, found with GITHUB_TOKEN)
  --sha <sha>       Commit the head run, or with --branch the run, was built from

Options for upload:
  --url <url>       Hosted viewer (default: NUXT_BUNDLE_ANALYZER_URL)
  --branch <name>   Instead of a pull request, add the run --name to this branch's history,
                    as built from --sha (default: GITHUB_SHA)

Options for comment:
  --link <url>      Comparison on the hosted viewer, the url upload prints, to lead the comment
  --output <file>   Write the comment to this file instead of printing it
  --post            Post the comment on the pull request with GITHUB_TOKEN, or update the one
                    posted before
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
    'branch': { type: 'string' },
    'link': { type: 'string' },
    'output': { type: 'string' },
    'post': { type: 'boolean', default: false },
    'help': { type: 'boolean', short: 'h' },
  },
})

const COMMANDS = [
  'analyze',
  'serve',
  'upload',
  'comment',
]
const command = COMMANDS.includes(positionals[0] ?? '')
  ? positionals.shift()!
  : 'analyze'
const rootDir = resolve(positionals[0] ?? '.')
// An option typed with an en or em dash, such as `—prerender`, arrives as the project directory.
if (!existsSync(rootDir)) {
  console.error(`There is no directory ${positionals[0]}. Options start with two hyphens, such as --prerender.`)
  process.exit(1)
}
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
  let pull: { number: number, sha: string } | undefined
  if (values.help) {
    console.log(HELP)
    return
  }
  if ((command === 'upload' && !values.branch) || (command === 'comment' && values.post)) {
    pull = values.pr
      ? {
          number: Number(values.pr),
          sha: values.sha ?? '',
        }
      : await findPullRequest()
    // Runs of a commit that is no longer the head of an open pull request are stale.
    if (!pull && process.env.GITHUB_EVENT_PATH) {
      console.log('Skipping: no open pull request has the commit of these runs as its head.')
      return
    }
  }
  if (command === 'upload') {
    const url = values.url ?? process.env.NUXT_BUNDLE_ANALYZER_URL
    let link: string
    if (url && values.branch) {
      const sha = values.sha ?? process.env.GITHUB_SHA
      if (!sha) {
        throw new Error('upload --branch needs --sha <sha> (or GITHUB_SHA) of the commit the run was built from.')
      }
      // The history is in the order of the commits, so a commit git does not have falls back to when it was built.
      const commit = readCommit(rootDir, sha)
      if (!commit.time) {
        console.warn(`git has no commit ${sha} in ${rootDir}, so the history places it when it was built.`)
      }
      link = await upload({
        runsDir,
        url,
        branch: values.branch,
        name: toSlug(values.name),
        ...commit,
      })
    }
    else if (url && pull && Number.isSafeInteger(pull.number) && pull.number > 0) {
      link = await upload({
        runsDir,
        url,
        base: values.base,
        head: values.head,
        pull: pull.number,
        sha: values.sha ?? pull.sha,
      })
    }
    else {
      throw new Error('upload needs --url (or NUXT_BUNDLE_ANALYZER_URL), and --pr <number> or --branch <name>.')
    }
    console.log(link)
    // In GitHub Actions, later steps read the link as `steps.<id>.outputs.url`.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `url=${link}\n`)
    }
    return
  }
  if (command === 'comment') {
    const [base, head] = await Promise.all([
      readRunData(join(runsDir, toSlug(values.base))),
      readRunData(join(runsDir, toSlug(values.head))),
    ])
    const markdown = renderComment(base, head, { link: values.link, sha: values.sha ?? pull?.sha })
    if (values.output) {
      writeFileSync(values.output, markdown)
    }
    if (values.post) {
      if (!pull || !Number.isSafeInteger(pull.number) || pull.number <= 0) {
        throw new Error('comment --post needs --pr <number>, or to run in GitHub Actions for a pull request.')
      }
      console.log(await postComment(pull.number, markdown))
    }
    else if (!values.output) {
      process.stdout.write(markdown)
    }
    // The run's summary keeps the report too, also when commenting is not allowed.
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
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
