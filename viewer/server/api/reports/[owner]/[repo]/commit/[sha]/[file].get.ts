import { RUN_FILES } from '../../../../../../utils/reports'
import { commitPrefix, sendReport } from '../../../../../../utils/storage'

const SEGMENT_RE = /^[\w.-]{1,100}$/

/** The files of a commit's run, which the history of its branch lists. */
export default defineEventHandler((event) => {
  const { owner, repo, sha, file } = getRouterParams(event)
  if (!SEGMENT_RE.test(owner ?? '') || !SEGMENT_RE.test(repo ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '') || !RUN_FILES.includes(file ?? '')) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  return sendReport(event, `${commitPrefix(`${owner}/${repo}`, sha!)}:${file}`)
})
