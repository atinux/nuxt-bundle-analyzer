import type { Driver } from 'unstorage'
import process from 'node:process'
import { del, list, put } from '@vercel/blob'
import fsDriver from 'unstorage/drivers/fs'

const pathname = (key: string) => `reports/${key.replace(/:+$/, '').replace(/:/g, '/')}`

async function find(key: string) {
  const { blobs } = await list({
    prefix: pathname(key),
  })
  return blobs.find(blob => blob.pathname === pathname(key))
}

async function save(key: string, value: any, options: object) {
  await put(pathname(key), value, { access: 'public', addRandomSuffix: false, ...options })
}

/**
 * Reports in Vercel Blob, under `reports/`. The SDK finds its own credentials: the deployment's
 * OIDC token with `BLOB_STORE_ID`, or `BLOB_READ_WRITE_TOKEN`. unstorage's own driver always passes
 * the read-write token, so a store upgraded to OIDC would keep needing it.
 */
const blobDriver: Driver = {
  name: 'vercel-blob',
  async hasItem(key) {
    return !!await find(key)
  },
  async getItem(key) {
    const blob = await find(key)
    return blob
      ? fetch(blob.url).then(res => res.text())
      : null
  },
  async getItemRaw(key) {
    const blob = await find(key)
    return blob
      ? fetch(blob.url).then(res => res.arrayBuffer())
      : null
  },
  setItem: save,
  setItemRaw: save,
  async removeItem(key) {
    await del(pathname(key))
  },
  async getKeys(base) {
    const prefix = `${pathname(base)}/`.replace(/\/+$/, '/')
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor })
      keys.push(...page.blobs.map(blob => blob.pathname.slice('reports/'.length)))
      cursor = page.cursor
    } while (cursor)
    return keys
  },
}

// Reports live in Vercel Blob once a store is connected to the project, which sets its store ID
// (or, for stores not upgraded to OIDC, only its token); in local runs and tests, on disk.
export default defineNitroPlugin(() => {
  useStorage().mount('reports', process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
    ? blobDriver
    : fsDriver({ base: process.env.NUXT_REPORTS_DIR || './.data/reports' }))
})
