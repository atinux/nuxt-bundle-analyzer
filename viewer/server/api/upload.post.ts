import { Buffer } from 'node:buffer'
import { STATUS_CODES } from 'node:http'
import process from 'node:process'
import { gunzipSync } from 'node:zlib'
import { createRemoteJWKSet } from 'jose'

import { RequestError, verifyGitHubToken } from '../utils/oidc'
import { parseUpload } from '../utils/reports'
import { saveCommit, saveUpload } from '../utils/storage'

/** Gzipped reports of a large app stay well under this, and under Vercel's 4.5 MB body limit. */
const MAX_BODY = 4 * 1024 * 1024
const MAX_UNCOMPRESSED = 128 * 1024 * 1024

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export default defineEventHandler(async (event) => {
  const { oidc } = useRuntimeConfig(event)
  const origin = getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
  try {
    // The token is checked before the body is read, so a request without one costs nothing.
    const token = getRequestHeader(event, 'authorization')?.match(/^Bearer (\S+)$/i)?.[1]
    if (!token) {
      throw new RequestError(401, 'Send a GitHub Actions OpenID Connect token as a Bearer token. The job needs `permissions: id-token: write`.')
    }
    if (!keySets.has(oidc.jwksUrl)) {
      keySets.set(oidc.jwksUrl, createRemoteJWKSet(new URL(oidc.jwksUrl)))
    }
    const claims = await verifyGitHubToken(token, {
      issuer: oidc.issuer,
      audience: oidc.audience || origin,
      allowedWorkflows: oidc.allowedWorkflows.split(',').map(workflow => workflow.trim()).filter(Boolean),
      keys: keySets.get(oidc.jwksUrl)!,
    })
    // Without a Blob store, reports would go to the deployment's read-only disk.
    if (process.env.VERCEL && !process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) {
      throw new RequestError(503, 'This viewer has no Blob store to keep reports in. Connect a Vercel Blob store to its project, then redeploy it.')
    }

    const raw = await readRawBody(event, false)
    if (!raw || raw.length === 0) {
      throw new RequestError(400, 'The upload is empty.')
    }
    if (raw.length > MAX_BODY) {
      throw new RequestError(413, 'The upload is too large.')
    }
    let text: string
    try {
      text = getRequestHeader(event, 'content-encoding') === 'gzip'
        ? gunzipSync(raw, { maxOutputLength: MAX_UNCOMPRESSED }).toString('utf8')
        : Buffer.from(raw).toString('utf8')
    }
    catch {
      throw new RequestError(413, 'The upload could not be decompressed, or is too large once decompressed.')
    }
    let body: unknown
    try {
      body = JSON.parse(text)
    }
    catch {
      throw new RequestError(400, 'The upload is not JSON.')
    }
    const upload = parseUpload(body)
    // Stored under the repository the token was issued to, never one the body names.
    const page = `${origin}/${claims.repository.toLowerCase()}`
    if (upload.kind === 'commit') {
      const history = await saveCommit(claims.repository, upload)
      const index = history.findIndex(commit => commit.sha === upload.commit.sha)
      const previous = history[index - 1]
      // Links to what the commit changed, or to the history when it is the first one.
      const query = previous
        ? `?${new URLSearchParams({ view: 'compare', base: previous.sha, run: upload.commit.sha })}`
        : ''
      return { url: `${page}/tree/${upload.branch}${query}` }
    }
    await saveUpload(claims.repository, upload)
    const query = new URLSearchParams({ view: 'compare', base: upload.base, run: upload.head })
    return { url: `${page}/pull/${upload.pull}?${query}` }
  }
  catch (error) {
    if (error instanceof RequestError) {
      throw createError({ statusCode: error.statusCode, statusMessage: STATUS_CODES[error.statusCode], message: error.message })
    }
    throw error
  }
})
