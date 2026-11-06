import type { Env, NuxtData, Run, RunData, SondaReport } from '../viewer/app/utils/data'

import { promises as fsp } from 'node:fs'
import { join } from 'pathe'

import { formatBytes, formatDelta, routeSize, toRunData } from '../viewer/app/utils/data'

/** Runs come from builds of a pull request's code, so a file this large is refused rather than parsed. */
const MAX_FILE_SIZE = 64 * 1024 * 1024
const MAX_ROWS = 10
const MAX_NAME_LENGTH = 200
/** Where the comment starts, so a workflow can find it again to update it. */
export const COMMENT_MARKER = '<!-- nuxt-bundle-analyzer -->'

async function readJson<T>(dir: string, file: string): Promise<T | undefined> {
  const path = join(dir, file)
  const stats = await fsp.lstat(path).catch(() => undefined)
  if (!stats) {
    return undefined
  }
  if (!stats.isFile() || stats.size > MAX_FILE_SIZE) {
    throw new Error(`${path} is not a file, or is larger than ${formatBytes(MAX_FILE_SIZE)}.`)
  }
  return JSON.parse(await fsp.readFile(path, 'utf8')) as T
}

/** Reads the run in `dir`, as `nuxt-bundle-analyzer --name=<name>` wrote it. */
export async function readRunData(dir: string): Promise<RunData> {
  const meta = await readJson<Run>(dir, 'meta.json')
  if (!meta) {
    throw new Error(`${dir} is not a run: it has no meta.json. Run \`nuxt-bundle-analyzer --name=<name>\` to create one.`)
  }
  const [client, nitro, nuxt] = await Promise.all([
    readJson<SondaReport>(dir, 'client.json'),
    readJson<SondaReport>(dir, 'nitro.json'),
    readJson<NuxtData>(dir, 'nuxt.json'),
  ])
  return toRunData(meta, { client, nitro }, nuxt)
}

/**
 * Names from the reports, such as routes and files, set as code. They come from the pull request,
 * so nothing in them can mention someone, link, or end the table cell.
 */
function code(name: string) {
  const text = String(name).length > MAX_NAME_LENGTH
    ? `${String(name).slice(0, MAX_NAME_LENGTH)}…`
    : String(name)
  const escaped = text.replace(/[&<>@|`[\]\\\r\n]/g, char => /\s/.test(char)
    ? ' '
    : `&#${char.charCodeAt(0)};`)
  return `<code>${escaped}</code>`
}

/** Sizes as numbers, as the reports could hold anything. */
function bytes(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number)
    ? number
    : 0
}

function percent(base: number, current: number) {
  if (base === 0) {
    return ''
  }
  const change = (current - base) / base * 100
  return ` (${change > 0
    ? '+'
    : '−'}${Math.abs(change).toFixed(1)}%)`
}

/**
 * A total for the summary line, with the change in green when it shrinks and red when it grows.
 * Comments can't carry styles, so the color comes from GitHub's math rendering, which only gets
 * formatted numbers here. `%` would start a TeX comment, so it is set as `\%`, whose backslash
 * Markdown takes one of.
 */
function total(label: string, base: number, current: number) {
  const delta = current - base
  if (delta === 0) {
    return `${label} ${formatBytes(current)} (no change)`
  }
  const change = `${formatDelta(delta)}${percent(base, current).replace(' (', ', ').replace(')', '')}`
    .replaceAll('−', '-')
    .replace('%', '}\\\\%\\textsf{')
  return `${label} ${formatBytes(current)} $\\color{${delta < 0
    ? 'green'
    : 'red'}}\\textsf{(${change})}$`
}

interface Row {
  key: string
  base?: number
  current?: number
  delta: number
}

/** What changed, the largest changes first, leaving out what did not. */
function changes(base: Map<string, number>, current: Map<string, number>): Row[] {
  return [
    ...new Set([
      ...base.keys(),
      ...current.keys(),
    ]),
  ]
    .map(key => ({
      key,
      base: base.get(key),
      current: current.get(key),
      delta: (current.get(key) ?? 0) - (base.get(key) ?? 0),
    }))
    .filter(row => row.delta !== 0 || row.base === undefined || row.current === undefined)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key))
}

function routeSizes(data: RunData) {
  return new Map(data.routes.map(route => [
    route.path,
    bytes(routeSize(data, route).brotli),
  ]))
}

/** The size of each package, and of each file outside one, in a build. */
function sourceSizes(data: RunData, env: Env) {
  const sizes = new Map<string, number>()
  for (const source of data.bundles[env]?.sources ?? []) {
    const key = source.package
      ? `node_modules/${source.package}`
      : source.id
    sizes.set(key, (sizes.get(key) ?? 0) + bytes(source.brotli))
  }
  return sizes
}

function sizeCell(size: number | undefined) {
  return size === undefined
    ? 'n/a'
    : formatBytes(size)
}

function more(rows: Row[], noun: string) {
  return rows.length > MAX_ROWS
    ? ['', `And ${rows.length - MAX_ROWS} more ${noun}.`]
    : []
}

function details(summary: string, lines: string[]) {
  return [
    '',
    '<details>',
    `<summary>${summary}</summary>`,
    '',
    ...lines,
    '',
    '</details>',
  ]
}

function sourceTable(rows: Row[]) {
  return [
    '| Package or file | Base | PR | Δ |',
    '| --- | ---: | ---: | ---: |',
    ...rows.slice(0, MAX_ROWS).map(row => `| ${code(row.key)} | ${sizeCell(row.base)} | ${sizeCell(row.current)} | ${formatDelta(row.delta)}${percent(row.base ?? 0, row.current ?? 0)} |`),
    ...more(rows, 'packages or files'),
  ]
}

export interface CommentOptions {
  /** The comparison on the hosted viewer, which leads the comment. */
  link?: string
  /** The commit the pull request run was built from, so a comment from an earlier push stands out. */
  sha?: string
}

const SAFE_URL_RE = /^https:\/\/[^\s()<>[\]"']+$/
const SHA_RE = /^[0-9a-f]{7,40}$/

/** The Markdown of a pull request comment comparing two runs, in Brotli sizes. */
export function renderComment(base: RunData, current: RunData, options: CommentOptions = {}): string {
  const size = (data: RunData, env: Env) => bytes(data.bundles[env]?.brotli)
  const lines = [
    COMMENT_MARKER,
    '## Bundle size',
    '',
    ...options.link && SAFE_URL_RE.test(options.link)
      ? [`**[Explore the comparison →](${options.link})**`, '']
      : [],
    [
      total('Client', size(base, 'client'), size(current, 'client')),
      total('Server', size(base, 'nitro'), size(current, 'nitro')),
    ].join(' · '),
  ]

  const routes = changes(routeSizes(base), routeSizes(current))
  if (routes.length > 0) {
    lines.push(
      '',
      '| Initial page load | PR | Δ |',
      '| --- | ---: | ---: |',
      ...routes.slice(0, MAX_ROWS).map(row => `| ${code(row.key)} | ${sizeCell(row.current)} | ${row.base === undefined
        ? 'added'
        : row.current === undefined
          ? 'removed'
          : `${formatDelta(row.delta)}${percent(row.base, row.current)}`} |`),
      ...more(routes, 'routes'),
    )
  }
  else if (current.routes.length > 0) {
    lines.push('', 'No route loads more or less before it renders.')
  }

  const client = changes(sourceSizes(base, 'client'), sourceSizes(current, 'client'))
  if (client.length > 0) {
    lines.push(...details('Largest changes in the client', sourceTable(client)))
  }
  const server = changes(sourceSizes(base, 'nitro'), sourceSizes(current, 'nitro'))
  if (server.length > 0) {
    lines.push(...details('Largest changes in the server', sourceTable(server)))
  }

  const notes = [
    'Brotli sizes.',
    ...routes.length > 0
      ? ['Initial page load counts the JavaScript and CSS a route loads before it renders.']
      : [],
    `Measured by <a href="https://github.com/atinux/nuxt-bundle-analyzer">nuxt-bundle-analyzer</a>${options.sha && SHA_RE.test(options.sha)
      ? ` for <code>${options.sha.slice(0, 7)}</code>`
      : ''}.`,
  ]
  lines.push('', `<sub>${notes.join(' ')}</sub>`)
  return `${lines.join('\n')}\n`
}
