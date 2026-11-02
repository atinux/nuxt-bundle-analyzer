import type { Upload } from './reports'

/** Where a pull request's comparison is stored: one per pull request, replaced by each upload. */
export function reportPrefix(repository: string, pull: number) {
  return `${repository.toLowerCase().replace('/', ':')}:pull:${pull}`
}

export async function saveUpload(repository: string, upload: Upload) {
  const storage = useStorage('reports')
  const prefix = reportPrefix(repository, upload.pull)
  // A new push replaces the runs, including files an earlier upload had and this one has not.
  await Promise.all((await storage.getKeys(prefix)).map(key => storage.removeItem(key)))
  const options = { allowOverwrite: true, cacheControlMaxAge: 60, contentType: 'application/json' }
  const runs = [upload.base, upload.head].map(name => ({ ...upload.meta[name]!, current: name === upload.head }))
  await storage.setItemRaw(`${prefix}:runs.json`, JSON.stringify(runs), options)
  for (const [name, files] of Object.entries(upload.runs)) {
    for (const [file, contents] of Object.entries(files)) {
      await storage.setItemRaw(`${prefix}:${name}:${file}`, contents, options)
    }
  }
}
