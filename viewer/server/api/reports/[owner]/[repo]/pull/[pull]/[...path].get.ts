import { RUN_FILES } from '../../../../../../utils/reports'
import { reportPrefix } from '../../../../../../utils/storage'

const SEGMENT_RE = /^[\w.-]{1,100}$/
const RUN_RE = /^[\w-]{1,64}$/

/** The files of a stored comparison, at the paths the viewer reads them from: `runs.json` and `<run>/<file>`. */
export default defineEventHandler(async (event) => {
  const { owner, repo, pull, path } = getRouterParams(event)
  const parts = (path ?? '').split('/')
  const valid = SEGMENT_RE.test(owner ?? '') && SEGMENT_RE.test(repo ?? '') && /^\d{1,9}$/.test(pull ?? '')
    && (parts.join('/') === 'runs.json' || (parts.length === 2 && RUN_RE.test(parts[0]!) && RUN_FILES.includes(parts[1]!)))
  if (!valid) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  const raw = await useStorage('reports').getItemRaw(`${reportPrefix(`${owner}/${repo}`, Number(pull))}:${parts.join(':')}`)
  if (!raw) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  setResponseHeaders(event, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
  return typeof raw === 'string'
    ? raw
    : new TextDecoder().decode(raw as ArrayBuffer)
})
