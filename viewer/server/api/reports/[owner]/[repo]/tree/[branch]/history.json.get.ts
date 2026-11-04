import { BRANCH_RE } from '../../../../../../utils/reports'
import { branchPrefix, sendReport } from '../../../../../../utils/storage'

const SEGMENT_RE = /^[\w.-]{1,100}$/

/** The commits of a branch that were uploaded, oldest first, with the size of each build. */
export default defineEventHandler((event) => {
  const { owner, repo, branch } = getRouterParams(event)
  if (!SEGMENT_RE.test(owner ?? '') || !SEGMENT_RE.test(repo ?? '') || !BRANCH_RE.test(branch ?? '')) {
    throw createError({ statusCode: 404, message: 'Not found' })
  }
  return sendReport(event, `${branchPrefix(`${owner}/${repo}`, branch!)}:history.json`)
})
