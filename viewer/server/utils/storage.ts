import type { Commit, CommitUpload, PullUpload } from './reports'

const OPTIONS = { allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json' }

function repositoryPrefix(repository: string) {
  return repository.toLowerCase().replace('/', ':')
}

/** Where a pull request's comparison is stored: one per pull request, replaced by each upload. */
export function reportPrefix(repository: string, pull: number) {
  return `${repositoryPrefix(repository)}:pull:${pull}`
}

/** Where the reports of a commit are stored, whichever branch it was uploaded for. */
export function commitPrefix(repository: string, sha: string) {
  return `${repositoryPrefix(repository)}:commit:${sha}`
}

/** Where a branch's history is stored: `history.json`, and each commit's summary under `commits`. */
export function branchPrefix(repository: string, branch: string) {
  return `${repositoryPrefix(repository)}:tree:${branch}`
}

/** Answers with a stored JSON file, or 404 when there is none. */
export async function sendReport(event: Parameters<typeof setResponseHeaders>[0], key: string) {
  const raw = await useStorage('reports').getItemRaw(key)
  if (!raw) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  setResponseHeaders(event, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
  return typeof raw === 'string'
    ? raw
    : new TextDecoder().decode(raw as ArrayBuffer)
}

export async function saveUpload(repository: string, upload: PullUpload) {
  const storage = useStorage('reports')
  const prefix = reportPrefix(repository, upload.pull)
  // A new push replaces the runs, including files an earlier upload had and this one has not.
  await Promise.all((await storage.getKeys(prefix)).map(key => storage.removeItem(key)))
  const runs = [upload.base, upload.head].map(name => ({ ...upload.meta[name]!, current: name === upload.head }))
  await storage.setItemRaw(`${prefix}:runs.json`, JSON.stringify(runs), OPTIONS)
  for (const [name, files] of Object.entries(upload.runs)) {
    for (const [file, contents] of Object.entries(files)) {
      await storage.setItemRaw(`${prefix}:${name}:${file}`, contents, OPTIONS)
    }
  }
}

/**
 * Stores a commit's reports and adds it to the history of its branch, oldest first, which it
 * returns. Uploads of several commits can overlap, as a backfill does, and the history read here
 * can be up to a minute old in Blob's cache, so each commit's summary is also stored on its own:
 * the history takes in every summary it is missing, and an upload that overwrote another's
 * commit puts it back on the next upload.
 */
export async function saveCommit(repository: string, upload: CommitUpload): Promise<Commit[]> {
  const storage = useStorage('reports')
  const { sha } = upload.commit
  const prefix = commitPrefix(repository, sha)
  await Promise.all((await storage.getKeys(prefix)).map(key => storage.removeItem(key)))
  for (const [file, contents] of Object.entries(upload.files)) {
    await storage.setItemRaw(`${prefix}:${file}`, contents, OPTIONS)
  }

  const branch = branchPrefix(repository, upload.branch)
  await storage.setItemRaw(`${branch}:commits:${sha}.json`, JSON.stringify(upload.commit), OPTIONS)
  const history = new Map(((await storage.getItem<Commit[]>(`${branch}:history.json`)) ?? []).map(commit => [commit.sha, commit]))
  history.set(sha, upload.commit)
  const missing = (await storage.getKeys(`${branch}:commits`))
    .map(key => /:([0-9a-f]{40})\.json$/.exec(key)?.[1])
    .filter((other): other is string => !!other && !history.has(other))
  for (const commit of await Promise.all(missing.map(other => storage.getItem<Commit>(`${branch}:commits:${other}.json`)))) {
    if (commit) {
      history.set(commit.sha, commit)
    }
  }
  const commits = [
    ...history.values(),
  ].sort((a, b) => a.time - b.time)
  await storage.setItemRaw(`${branch}:history.json`, JSON.stringify(commits), OPTIONS)
  return commits
}
