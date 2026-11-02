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

export interface Upload {
  pull: number
  sha?: string
  base: string
  head: string
  /** The files of each run as JSON text, rewritten from what was parsed. */
  runs: Record<string, Record<string, string>>
  meta: Record<string, StoredRun>
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Checks an upload, which comes from a build of untrusted code: only known runs and files,
 * each a JSON object, within size limits. Every file is parsed and serialized again, so what
 * is stored is plain JSON whatever was sent.
 */
export function parseUpload(body: unknown): Upload {
  if (!isObject(body) || body.version !== 1) {
    throw new RequestError(400, 'The upload is not a version 1 upload.')
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

  const upload: Upload = {
    pull: pull as number,
    sha: sha as string | undefined,
    base,
    head,
    runs: {},
    meta: {},
  }
  for (const name of [base, head]) {
    const files = runs[name]
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
    // The run is named after its place in the comparison, whatever name it was built with.
    upload.meta[name] = {
      name,
      slug: name,
      startTime: meta.startTime,
      endTime: meta.endTime,
    }
    run['meta.json'] = JSON.stringify(upload.meta[name])
    upload.runs[name] = run
  }
  return upload
}
