import { normalizeId, packageOf } from '../../app/utils/data'
import { RequestError } from './oidc'

/** The files of a run the viewer reads. */
export const RUN_FILES = [
  'client.json',
  'nitro.json',
  'nuxt.json',
  'meta.json',
]

const NAME_RE = /^[\w-]{1,64}$/
/** Sonda's report of a large app is a few megabytes; this leaves plenty of room. */
const MAX_FILE_LENGTH = 32 * 1024 * 1024

export interface StoredRun {
  name: string
  slug: string
  startTime: number
  endTime: number
}

export interface Sizes {
  uncompressed: number
  gzip: number
  brotli: number
}

/** A commit of a branch's history: what the trend shows without downloading its reports. */
export interface Commit {
  sha: string
  /** The first line of its message. */
  message?: string
  /** When it was committed, in milliseconds, which orders the history. */
  time: number
  /** The total of each build, as Compare adds it up: every output file in Sonda's report. */
  sizes: Partial<Record<'client' | 'nitro', Sizes>>
  /**
   * The largest packages of each build, by name. Commits uploaded before it was recorded
   * have none until `saveCommit` reads their reports again.
   */
  packages?: Partial<Record<'client' | 'nitro', Record<string, Sizes>>>
}

/** Two runs compared for a pull request. */
export interface PullUpload {
  kind: 'pull'
  pull: number
  sha?: string
  base: string
  head: string
  /** The files of each run as JSON text, rewritten from what was parsed. */
  runs: Record<string, Record<string, string>>
  meta: Record<string, StoredRun>
}

/** One run, built from a commit pushed to a branch. */
export interface CommitUpload {
  kind: 'commit'
  branch: string
  commit: Commit
  /** The files of the run as JSON text, rewritten from what was parsed. */
  files: Record<string, string>
}

export type Upload = PullUpload | CommitUpload

/** A branch name that is also a single path segment, such as `main` or `v4`. */
export const BRANCH_RE = /^\w[\w.-]{0,99}$/
const SHA_RE = /^[0-9a-f]{40}$/

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Checks the files of one run and serializes each again, with its `meta.json` named `name`. */
function parseRun(name: string, files: unknown): { files: Record<string, string>, meta: StoredRun } {
  if (!isObject(files) || !Object.keys(files).every(file => RUN_FILES.includes(file))) {
    throw new RequestError(400, `The run ${name} has files other than ${RUN_FILES.join(', ')}.`)
  }
  const run: Record<string, string> = {}
  for (const [file, contents] of Object.entries(files)) {
    if (typeof contents !== 'string' || contents.length > MAX_FILE_LENGTH) {
      throw new RequestError(413, `${name}/${file} is missing or too large.`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    }
    catch {
      throw new RequestError(400, `${name}/${file} is not JSON.`)
    }
    if (!isObject(parsed)) {
      throw new RequestError(400, `${name}/${file} is not a JSON object.`)
    }
    run[file] = JSON.stringify(parsed)
  }
  const meta = run['meta.json'] && JSON.parse(run['meta.json']) as Record<string, unknown>
  if (!meta || typeof meta.startTime !== 'number' || typeof meta.endTime !== 'number') {
    throw new RequestError(400, `The run ${name} has no meta.json with its start and end times.`)
  }
  const stored = {
    name,
    slug: name,
    startTime: meta.startTime,
    endTime: meta.endTime,
  }
  run['meta.json'] = JSON.stringify(stored)
  return { files: run, meta: stored }
}

/** How many packages of each build a commit keeps, which keeps the history small. */
const PACKAGES_KEPT = 20

function add(sizes: Sizes, resource: Record<string, unknown>) {
  for (const metric of ['uncompressed', 'gzip', 'brotli'] as const) {
    const value = resource[metric]
    sizes[metric] += typeof value === 'number' && Number.isFinite(value)
      ? value
      : 0
  }
}

/**
 * The total of a Sonda report's output files, and its largest packages with what each adds to
 * them, or nothing when the run has no such report.
 */
export function summarize(json: string | undefined): { total: Sizes, packages: Record<string, Sizes> } | undefined {
  const report = json && JSON.parse(json) as { resources?: unknown }
  if (!report) {
    return undefined
  }
  const total = { uncompressed: 0, gzip: 0, brotli: 0 }
  const packages = new Map<string, Sizes>()
  for (const resource of Array.isArray(report.resources)
    ? report.resources
    : []) {
    if (!isObject(resource)) {
      continue
    }
    if (resource.kind === 'asset') {
      add(total, resource)
    }
    else if (resource.kind === 'chunk' && typeof resource.name === 'string') {
      // Named as the viewer names them, so each package adds up wherever it was installed.
      const name = packageOf(normalizeId(resource.name))
      if (name) {
        const sizes = packages.get(name) ?? { uncompressed: 0, gzip: 0, brotli: 0 }
        add(sizes, resource)
        packages.set(name, sizes)
      }
    }
  }
  const largest = [...packages].sort((a, b) => b[1].uncompressed - a[1].uncompressed).slice(0, PACKAGES_KEPT)
  return {
    total,
    packages: Object.fromEntries(largest),
  }
}

function parseCommit(body: Record<string, unknown>): CommitUpload {
  const { branch, sha, message, time, run } = body
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) {
    throw new RequestError(400, 'The upload needs a branch named with letters, digits, `_`, `.` or `-`.')
  }
  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    throw new RequestError(400, 'The upload needs the full SHA of the commit the run was built from.')
  }
  if (message !== undefined && typeof message !== 'string') {
    throw new RequestError(400, 'The commit message is not text.')
  }
  if (time !== undefined && (typeof time !== 'number' || !Number.isFinite(time) || time <= 0)) {
    throw new RequestError(400, 'The commit time is not a valid time.')
  }
  // Each commit's reports are stored once, under its SHA, which names the run too.
  const { files, meta } = parseRun(sha, run)
  const client = summarize(files['client.json'])
  const nitro = summarize(files['nitro.json'])
  return {
    kind: 'commit',
    branch,
    commit: {
      sha,
      message: message?.split('\n')[0]!.slice(0, 200) || undefined,
      time: time ?? meta.endTime,
      sizes: {
        client: client?.total,
        nitro: nitro?.total,
      },
      packages: {
        client: client?.packages,
        nitro: nitro?.packages,
      },
    },
    files,
  }
}

/**
 * Checks an upload, which comes from a build of untrusted code: only known runs and files,
 * each a JSON object, within size limits. Every file is parsed and serialized again, so what
 * is stored is plain JSON whatever was sent. An upload is either the two runs of a pull request,
 * or the run of a commit on a branch.
 */
export function parseUpload(body: unknown): Upload {
  if (!isObject(body) || body.version !== 1) {
    throw new RequestError(400, 'The upload is not a version 1 upload.')
  }
  if (body.branch !== undefined) {
    return parseCommit(body)
  }
  const { pull, sha, base, head, runs } = body
  if (!Number.isSafeInteger(pull) || (pull as number) <= 0) {
    throw new RequestError(400, 'The upload has no valid pull request number.')
  }
  if (sha !== undefined && (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/.test(sha))) {
    throw new RequestError(400, 'The upload has an invalid commit.')
  }
  if (typeof base !== 'string' || typeof head !== 'string' || !NAME_RE.test(base) || !NAME_RE.test(head) || base === head) {
    throw new RequestError(400, 'The upload needs two different runs named with letters, digits, `_` or `-`.')
  }
  if (!isObject(runs) || Object.keys(runs).sort().join() !== [base, head].sort().join()) {
    throw new RequestError(400, 'The upload must contain exactly the base and head runs.')
  }

  const upload: PullUpload = {
    kind: 'pull',
    pull: pull as number,
    sha: sha as string | undefined,
    base,
    head,
    runs: {},
    meta: {},
  }
  for (const name of [base, head]) {
    // The run is named after its place in the comparison, whatever name it was built with.
    const run = parseRun(name, runs[name])
    upload.meta[name] = run.meta
    upload.runs[name] = run.files
  }
  return upload
}
