import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMMENT_MARKER } from '../src/comment'
import { findPullRequest, postComment } from '../src/github'

const HEAD = 'a'.repeat(40)
const FORK = 7
const REPO = 1

/** A `workflow_run` event for a pull request from a fork, whose `pull_requests` is empty. */
const workflowRun = {
  repository: { id: REPO },
  workflow_run: {
    event: 'pull_request',
    head_sha: HEAD,
    head_branch: 'fix',
    head_repository: {
      id: FORK,
      owner: { login: 'someone' },
    },
    pull_requests: [],
  },
}

function pull(number: number, sha = HEAD, headRepo = FORK, baseRepo = REPO) {
  return {
    number,
    head: {
      sha,
      repo: { id: headRepo },
    },
    base: {
      repo: { id: baseRepo },
    },
  }
}

/** Answers the GitHub API from `routes`, keyed by method and path, and records each request. */
function serve(routes: Record<string, unknown>) {
  const requests: { method: string, path: string, body?: unknown }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(url)
    const method = init.method ?? 'GET'
    requests.push({ method, path: pathname + search, body: init.body && JSON.parse(init.body as string) })
    const key = Object.keys(routes).find(key => key === `${method} ${pathname}`)
    return key
      ? Response.json(routes[key])
      : new Response('Not found', { status: 404 })
  })
  return requests
}

function event(payload: unknown) {
  const path = join(mkdtempSync(join(tmpdir(), 'event-')), 'event.json')
  writeFileSync(path, JSON.stringify(payload))
  vi.stubEnv('GITHUB_EVENT_PATH', path)
}

beforeEach(() => {
  vi.stubEnv('GITHUB_REPOSITORY', 'nuxt/ui')
  vi.stubEnv('GITHUB_TOKEN', 'token')
  vi.stubEnv('GITHUB_API_URL', 'https://api.github.test')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('findPullRequest', () => {
  it('finds a fork\'s pull request from a workflow_run by its head branch and commit', async () => {
    event(workflowRun)
    const requests = serve({
      'GET /repos/nuxt/ui/pulls': [
        pull(41, 'b'.repeat(40)),
        pull(42),
      ],
    })
    await expect(findPullRequest()).resolves.toEqual({ number: 42, sha: HEAD })
    expect(requests[0]!.path).toContain('head=someone%3Afix')
  })

  it.each([
    [
      'has a newer commit',
      pull(42, 'b'.repeat(40)),
    ],
    [
      'comes from another repository',
      pull(42, HEAD, 99),
    ],
    [
      'targets another repository',
      pull(42, HEAD, FORK, 99),
    ],
  ])('skips a pull request that %s', async (_, candidate) => {
    event(workflowRun)
    serve({
      'GET /repos/nuxt/ui/pulls': [candidate],
    })
    await expect(findPullRequest()).resolves.toBeUndefined()
  })

  it('reads a pull_request event without asking GitHub', async () => {
    event({
      pull_request: {
        number: 5,
        head: { sha: HEAD },
      },
    })
    const requests = serve({})
    await expect(findPullRequest()).resolves.toEqual({ number: 5, sha: HEAD })
    expect(requests).toEqual([])
  })
})

describe('postComment', () => {
  it('updates the comment a bot posted before, not one quoting the marker', async () => {
    const requests = serve({
      'GET /repos/nuxt/ui/issues/42/comments': [
        {
          id: 1,
          body: `> ${COMMENT_MARKER}`,
          user: { type: 'User' },
        },
        {
          id: 2,
          body: `${COMMENT_MARKER}\nold`,
          user: { type: 'Bot' },
        },
      ],
      'PATCH /repos/nuxt/ui/issues/comments/2': { html_url: 'https://github.com/nuxt/ui/pull/42#issuecomment-2' },
    })
    await expect(postComment(42, `${COMMENT_MARKER}\nnew`)).resolves.toContain('issuecomment-2')
    expect(requests.at(-1)).toMatchObject({
      method: 'PATCH',
      body: { body: `${COMMENT_MARKER}\nnew` },
    })
  })

  it('posts a comment when there is none', async () => {
    const requests = serve({
      'GET /repos/nuxt/ui/issues/42/comments': [],
      'POST /repos/nuxt/ui/issues/42/comments': { html_url: 'https://github.com/nuxt/ui/pull/42#issuecomment-3' },
    })
    await postComment(42, 'body')
    expect(requests.at(-1)).toMatchObject({ method: 'POST', path: '/repos/nuxt/ui/issues/42/comments' })
  })
})
