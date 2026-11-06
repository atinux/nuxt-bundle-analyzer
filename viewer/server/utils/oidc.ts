import type { JWTPayload, JWTVerifyGetKey } from 'jose'

import { jwtVerify } from 'jose'

/** A request the viewer refuses, with the status it answers. */
export class RequestError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
  }
}

/** The claims of a GitHub Actions OpenID Connect token that the viewer relies on. */
export interface GitHubClaims extends JWTPayload {
  /** The repository the workflow runs in, such as `nuxt/nuxt.com`. */
  repository: string
  /** The workflow file running the job and the ref it was read from. */
  job_workflow_ref: string
}

export interface VerifyOptions {
  issuer: string
  audience: string
  /**
   * `job_workflow_ref` values allowed to upload, where `*` stands for any characters but `/` and `@`:
   * a `*` in place of the repository allows every repository of the owner.
   */
  allowedWorkflows: string[]
  keys: JWTVerifyGetKey
}

/**
 * Whether a workflow matches an allowed pattern. `*` can't reach past a `/` or an `@`, so
 * `@refs/heads/main` can't be met by another branch, nor `nuxt/*` by another owner.
 */
function matchesWorkflow(pattern: string, workflow: string) {
  const source = pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/@]*')
  return new RegExp(`^${source}$`).test(workflow)
}

/**
 * Checks that a token was signed by GitHub for this viewer, and that the job runs one of the
 * allowed workflows. The workflow check is what keeps pull requests out: a workflow running
 * code from a pull request has a ref other than the default branch's.
 */
export async function verifyGitHubToken(token: string, options: VerifyOptions): Promise<GitHubClaims> {
  let payload: JWTPayload
  try {
    ({ payload } = await jwtVerify(token, options.keys, {
      issuer: options.issuer,
      audience: options.audience,
      algorithms: ['RS256'],
    }))
  }
  catch (error) {
    throw new RequestError(401, `The token is not a valid GitHub Actions token for this viewer: ${(error as Error).message}`)
  }
  const { repository, job_workflow_ref: workflow } = payload as Partial<GitHubClaims>
  if (typeof workflow !== 'string' || !options.allowedWorkflows.some(pattern => matchesWorkflow(pattern, workflow))) {
    throw new RequestError(403, `The workflow ${workflow} is not allowed to upload. Add it to NUXT_OIDC_ALLOWED_WORKFLOWS.`)
  }
  // A workflow another repository calls runs with that repository's name, which would store
  // reports under it, so the workflow must belong to the repository the job runs in.
  if (typeof repository !== 'string' || !workflow.startsWith(`${repository}/`)) {
    throw new RequestError(403, `The workflow ${workflow} does not belong to ${repository}.`)
  }
  return payload as GitHubClaims
}
