import process from 'node:process'
import fsDriver from 'unstorage/drivers/fs'
import vercelBlobDriver from 'unstorage/drivers/vercel-blob'

// Reports live in Vercel Blob once a store is connected to the project, which sets its token;
// in local runs and tests, on disk.
export default defineNitroPlugin(() => {
  useStorage().mount('reports', process.env.BLOB_READ_WRITE_TOKEN
    ? vercelBlobDriver({ access: 'public', base: 'reports' })
    : fsDriver({ base: process.env.NUXT_REPORTS_DIR || './.data/reports' }))
})
