import { execFileSync } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { join } from 'pathe'

import { RUN_FILES } from './runs'

interface Target {
  /** The directory with one directory per run, such as `base/` and `pr/`. */
  runsDir: string
  /** The hosted viewer, such as `https://bundle.nuxt.dev`. */
  url: string
}

/** Two runs, compared for a pull request. */
export interface PullUploadOptions extends Target {
  base: string
  head: string
  pull: number
  sha?: string
}

/** One run, added to the history of the branch its commit was pushed to. */
export interface CommitUploadOptions extends Target {
  branch: string
  /** The run built from the commit. */
  name: string
  /** The full SHA of the commit. */
  sha: string
  /** The first line of its message. */
  message?: string
  /** When it was committed, in milliseconds. */
  time?: number
}

export type UploadOptions = PullUploadOptions | CommitUploadOptions

/** The body of an upload, which the hosted viewer checks again before storing it. */
export type UploadPayload = {
  version: 1
  pull: number
  sha?: string
  base: string
  head: string
  /** The files of each run, as the JSON text read from disk. */
  runs: Record<string, Record<string, string>>
} | {
  version: 1
  branch: string
  sha: string
  message?: string
  time?: number
  /** The files of the run, as the JSON text read from disk. */
  run: Record<string, string>
}

/** The full SHA, message and time of a commit in the repository at `dir`, when git has it. */
export function readCommit(dir: string, sha: string): { sha: string, message?: string, time?: number } {
  try {
    const [full, time, message] = execFileSync('git', [
      'show',
      '--no-patch',
      '--format=%H%n%ct%n%s',
      sha,
    ], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n')
    return { sha: full || sha, message: message || undefined, time: Number(time) * 1000 || undefined }
  }
  catch {
    return { sha }
  }
}

/**
 * Asks GitHub Actions for a short-lived OpenID Connect token meant for the viewer. The job
 * needs `id-token: write`; the token says which repository and workflow it comes from, which
 * the viewer checks instead of a shared secret.
 */
export async function requestGitHubToken(audience: string): Promise<string> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
  const token = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
  if (!url || !token) {
    throw new Error('Uploading needs a GitHub Actions OpenID Connect token. Give the job `permissions: id-token: write`.')
  }
  const request = new URL(url)
  request.searchParams.set('audience', audience)
  const response = await fetch(request, {
    headers: { authorization: `bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(`GitHub did not issue an OpenID Connect token (${response.status} ${response.statusText}).`)
  }
  const { value } = await response.json() as { value?: string }
  if (!value) {
    throw new Error('GitHub returned an empty OpenID Connect token.')
  }
  return value
}

async function readRun(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const file of RUN_FILES) {
    const contents = await fsp.readFile(join(dir, file), 'utf8').catch(() => undefined)
    if (contents !== undefined) {
      files[file] = contents
    }
  }
  if (!files['meta.json']) {
    throw new Error(`${dir} is not a run: it has no meta.json. Run \`nuxt-bundle-analyzer --name=<name>\` to create one.`)
  }
  return files
}

/**
 * Sends runs to the hosted viewer and resolves with the URL that shows them: the comparison of a
 * pull request, or what a commit changed in the history of its branch.
 */
export async function upload(options: UploadOptions): Promise<string> {
  const viewer = new URL(options.url)
  const payload: UploadPayload = 'branch' in options
    ? {
        version: 1,
        branch: options.branch,
        sha: options.sha,
        message: options.message,
        time: options.time,
        run: await readRun(join(options.runsDir, options.name)),
      }
    : {
        version: 1,
        pull: options.pull,
        sha: options.sha,
        base: options.base,
        head: options.head,
        runs: {
          [options.base]: await readRun(join(options.runsDir, options.base)),
          [options.head]: await readRun(join(options.runsDir, options.head)),
        },
      }
  const token = await requestGitHubToken(viewer.origin)
  // Reports compress well, which keeps uploads of large apps under serverless body limits.
  const body = gzipSync(JSON.stringify(payload))
  const response = await fetch(new URL('/api/upload', viewer), {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    },
    body,
  })
  const result = await response.json().catch(() => ({})) as { url?: string, message?: string, statusMessage?: string }
  if (!response.ok || !result.url) {
    throw new Error(`The viewer refused the upload (${response.status}): ${result.message || result.statusMessage || response.statusText}`)
  }
  return result.url
}
