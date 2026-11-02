import { promises as fsp } from 'node:fs'
import { join } from 'pathe'

/** The files of a run: Sonda's reports of each build, the routes and chunks, and its name and time. */
export const RUN_FILES = [
  'client.json',
  'nitro.json',
  'nuxt.json',
  'meta.json',
]

const NON_WORD_RE = /[^\w-]/g

/** The directory name of a run: `after/fix` and `after_fix` share one. */
export function toSlug(name: string) {
  return name.trim().replace(NON_WORD_RE, '_') || 'default'
}

export function defaultRunsDir(rootDir: string) {
  return join(rootDir, 'node_modules/.cache/nuxt-bundle-analyzer')
}

export interface Run {
  name: string
  slug: string
  startTime: number
  endTime: number
}

/** The runs in a directory, newest first, read from the `meta.json` of each. */
export async function listRuns(runsDir: string): Promise<Run[]> {
  const dirs = await fsp.readdir(runsDir, { withFileTypes: true }).catch(() => [])
  const runs = await Promise.all(dirs.filter(dir => dir.isDirectory()).map(dir =>
    fsp.readFile(join(runsDir, dir.name, 'meta.json'), 'utf8').then(json => JSON.parse(json) as Run, () => undefined),
  ))
  return runs
    .filter((run): run is Run => run !== undefined && toSlug(run.slug ?? '') === run.slug)
    .sort((a, b) => b.endTime - a.endTime)
}
