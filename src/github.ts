import { readFileSync } from 'node:fs'
import process from 'node:process'

import { COMMENT_MARKER } from './comment'

/** A pull request, and the commit of its head the runs were built from. */
export interface PullRequest {
  number: number
  sha: string
}

interface ApiPull {
  number: number
  head: { sha: string, repo: { id: number } | null }
  base: { repo: { id: number } }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('Set GITHUB_TOKEN in the step\'s env to the job\'s token to find and comment on the pull request.')
  }
  const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
    ...init,
    headers: {
      'accept': 'application/vnd.github+json',
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} to ${init.method ?? 'GET'} ${path}: ${await response.text()}`)
  }
  return response.json() as Promise<T>
}

/**
 * The pull request of the GitHub Actions event this runs in: the one that triggered a
 * `pull_request` workflow, or, in a `workflow_run` workflow, the open one whose head is the commit
 * the triggering run built. A fork's pull request is not in `workflow_run.pull_requests`, so it is
 * found by its head branch. Undefined outside GitHub Actions, or once the pull request was closed
 * or got a new commit, as the runs are then stale.
 */
export async function findPullRequest(): Promise<PullRequest | undefined> {
  const repository = process.env.GITHUB_REPOSITORY
  if (!process.env.GITHUB_EVENT_PATH || !repository) {
    return undefined
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (event.pull_request) {
    return { number: event.pull_request.number, sha: event.pull_request.head.sha }
  }
  const run = event.workflow_run
  if (!run || run.event !== 'pull_request' || !run.head_repository) {
    return undefined
  }
  const head = encodeURIComponent(`${run.head_repository.owner.login}:${run.head_branch}`)
  const pulls = await api<ApiPull[]>(`/repos/${repository}/pulls?state=open&head=${head}&per_page=100`)
  const pull = pulls.find(pull => pull.head.sha === run.head_sha
    && pull.head.repo?.id === run.head_repository.id
    && pull.base.repo.id === event.repository.id)
  return pull && { number: pull.number, sha: run.head_sha }
}

/** Updates the comment an earlier run posted on the pull request, or posts one. */
export async function postComment(pull: number, body: string): Promise<string> {
  const issue = `/repos/${process.env.GITHUB_REPOSITORY}/issues`
  let previous: { id: number } | undefined
  for (let page = 1; !previous; page++) {
    const comments = await api<{ id: number, body?: string, user?: { type?: string } }[]>(`${issue}/${pull}/comments?per_page=100&page=${page}`)
    previous = comments.find(comment => comment.user?.type === 'Bot' && comment.body?.startsWith(COMMENT_MARKER))
    if (comments.length < 100) {
      break
    }
  }
  const comment = previous
    ? await api<{ html_url: string }>(`${issue}/comments/${previous.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      })
    : await api<{ html_url: string }>(`${issue}/${pull}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
  return comment.html_url
}
