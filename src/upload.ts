import { promises as fsp } from 'node:fs'
import process from 'node:process'
import { gzipSync } from 'node:zlib'
import { join } from 'pathe'

import { RUN_FILES } from './runs'

export interface UploadOptions {
  /** The directory with one directory per run, such as `base/` and `pr/`. */
  runsDir: string
  base: string
  head: string
  pull: number
  /** The hosted viewer, such as `https://bundle.nuxt.dev`. */
  url: string
  sha?: string
}

/** The body of an upload, which the hosted viewer checks again before storing it. */
export interface UploadPayload {
  version: 1
  pull: number
  sha?: string
  base: string
  head: string
  /** The files of each run, as the JSON text read from disk. */
  runs: Record<string, Record<string, string>>
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

/** Sends two runs to the hosted viewer and resolves with the URL that compares them. */
export async function upload(options: UploadOptions): Promise<string> {
  const viewer = new URL(options.url)
  const payload: UploadPayload = {
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
