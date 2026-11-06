import type { CryptoKey, JWTPayload } from 'jose'

import type { CommitUpload, PullUpload } from '../viewer/server/utils/reports'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

import { beforeAll, describe, expect, it } from 'vitest'

import { verifyGitHubToken } from '../viewer/server/utils/oidc'
import { parseUpload } from '../viewer/server/utils/reports'

const ISSUER = 'https://token.actions.githubusercontent.com'
const AUDIENCE = 'https://bundle.nuxt.dev'
const WORKFLOW = 'nuxt/nuxt.com/.github/workflows/bundle-size-comment.yml@refs/heads/main'

let key: CryptoKey
let otherKey: CryptoKey
let keys: ReturnType<typeof createLocalJWKSet>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  key = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  keys = createLocalJWKSet({
    keys: [
      {
        ...await exportJWK(pair.publicKey),
        kid: 'github',
        alg: 'RS256',
      },
    ],
  })
})

/** A token shaped like GitHub's, for the trusted workflow unless the claims say otherwise. */
function sign(claims: JWTPayload = {}, { signingKey = key, issuer = ISSUER, audience = AUDIENCE, expires = '5m' } = {}) {
  return new SignJWT({ repository: 'nuxt/nuxt.com', job_workflow_ref: WORKFLOW, ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'github' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(signingKey)
}

function verify(token: string, allowedWorkflows = [WORKFLOW]) {
  return verifyGitHubToken(token, {
    issuer: ISSUER,
    audience: AUDIENCE,
    allowedWorkflows,
    keys,
  })
}

describe('verifyGitHubToken', () => {
  it('accepts a token of the allowed workflow on the default branch', async () => {
    await expect(verify(await sign())).resolves.toMatchObject({ repository: 'nuxt/nuxt.com', job_workflow_ref: WORKFLOW })
  })

  it('rejects the same workflow run from a pull request', async () => {
    // A pull request can edit the workflow, so its ref must not pass for the trusted one.
    const token = await sign({ job_workflow_ref: 'nuxt/nuxt.com/.github/workflows/bundle-size-comment.yml@refs/pull/12/merge' })
    await expect(verify(token)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('accepts any repository of an owner a pattern allows, on the allowed ref only', async () => {
    const allowed = ['nuxt/*/.github/workflows/*@refs/heads/main']
    const token = (repository: string, ref: string) => sign({ repository, job_workflow_ref: `${repository}/.github/workflows/bundle.yml@${ref}` })
    await expect(verify(await token('nuxt/ui', 'refs/heads/main'), allowed)).resolves.toMatchObject({ repository: 'nuxt/ui' })
    for (const [repository, ref] of [
      // Another owner whose name starts the same.
      ['nuxt-evil/ui', 'refs/heads/main'],
      ['nuxt/ui', 'refs/heads/feature'],
      ['nuxt/ui', 'refs/heads/main-feature'],
      ['nuxt/ui', 'refs/pull/12/merge'],
    ] as const) {
      await expect(verify(await token(repository, ref), allowed)).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('rejects an allowed workflow called from another repository', async () => {
    await expect(verify(await sign({ repository: 'someone/fork' }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    [
      'another audience',
      () => sign({}, { audience: 'https://example.com' }),
    ],
    [
      'another issuer',
      () => sign({}, { issuer: 'https://example.com' }),
    ],
    [
      'another key',
      () => sign({}, { signingKey: otherKey }),
    ],
    [
      'an expired token',
      () => sign({}, { expires: '-1m' }),
    ],
  ])('rejects %s', async (_, token) => {
    await expect(verify(await token())).rejects.toMatchObject({ statusCode: 401 })
  })
})

function meta(name: string) {
  return JSON.stringify({
    name,
    slug: name,
    startTime: 1,
    endTime: 2,
  })
}
function upload(runs: Record<string, Record<string, string>>, extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    pull: 12,
    base: 'base',
    head: 'pr',
    runs,
    ...extra,
  }
}
function valid() {
  return {
    base: {
      'meta.json': meta('built-as-main'),
      'client.json': '{ "resources": [] }',
    },
    pr: {
      'meta.json': meta('pr'),
    },
  }
}

describe('parseUpload', () => {
  it('keeps the files of both runs, rewritten as plain JSON and named after their place in the comparison', () => {
    const parsed = parseUpload(upload(valid())) as PullUpload
    expect(parsed.runs.base!['client.json']).toBe('{"resources":[]}')
    expect(JSON.parse(parsed.runs.base!['meta.json']!)).toEqual({
      name: 'base',
      slug: 'base',
      startTime: 1,
      endTime: 2,
    })
    expect(Object.keys(parsed.runs.pr!)).toEqual(['meta.json'])
  })

  it.each([
    [
      'a file the viewer does not read',
      () => upload({
        ...valid(),
        pr: {
          'meta.json': meta('pr'),
          'index.html': '{}',
        },
      }),
    ],
    [
      'a file that is not JSON',
      () => upload({
        ...valid(),
        pr: {
          'meta.json': meta('pr'),
          'client.json': '<script>',
        },
      }),
    ],
    [
      'a JSON value that is not an object',
      () => upload({
        ...valid(),
        pr: {
          'meta.json': meta('pr'),
          'client.json': '"text"',
        },
      }),
    ],
    [
      'a run without meta.json',
      () => upload({
        ...valid(),
        pr: { 'client.json': '{}' },
      }),
    ],
    [
      'a third run',
      () => upload({
        ...valid(),
        other: {
          'meta.json': meta('other'),
        },
      }),
    ],
    [
      'a run name with a path in it',
      () => upload({ 'base': valid().base, '../pr': valid().pr }, { head: '../pr' }),
    ],
    [
      'no pull request number',
      () => upload(valid(), { pull: 0 }),
    ],
  ])('rejects %s', (_, body) => {
    expect(() => parseUpload(body())).toThrow(expect.objectContaining({
      statusCode: expect.any(Number),
    }))
  })
})

const SHA = 'a0d0b17aa86c4f3e7d1b2a6c9e8f0d1c2b3a4f5e'

function commitUpload(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    branch: 'main',
    sha: SHA,
    run: {
      'meta.json': meta('main'),
      'client.json': JSON.stringify({
        resources: [
          {
            kind: 'asset',
            name: '_nuxt/entry.js',
            uncompressed: 100,
            gzip: 30,
            brotli: 20,
          },
          {
            kind: 'asset',
            name: '_nuxt/entry.css',
            uncompressed: 50,
            gzip: 10,
            brotli: 5,
          },
          // The parts of an output file, which its size already counts.
          {
            kind: 'chunk',
            name: 'app.vue',
            parent: '_nuxt/entry.js',
            uncompressed: 999,
            gzip: 999,
            brotli: 999,
          },
        ],
      }),
    },
    ...extra,
  }
}

describe('parseUpload of a commit', () => {
  it('sums the output files of each build, and leaves out a build the run has no report of', () => {
    const parsed = parseUpload(commitUpload({ message: 'feat: charts (#12)\n\nA longer body', time: 1_700_000_000_000 })) as CommitUpload
    expect(parsed.commit).toEqual({
      sha: SHA,
      message: 'feat: charts (#12)',
      time: 1_700_000_000_000,
      sizes: {
        client: { uncompressed: 150, gzip: 40, brotli: 25 },
        nitro: undefined,
      },
    })
    expect(JSON.parse(parsed.files['meta.json']!)).toMatchObject({ name: SHA, slug: SHA })
  })

  it('places a commit without a time when it was built', () => {
    expect((parseUpload(commitUpload()) as CommitUpload).commit.time).toBe(2)
  })

  it.each([
    [
      'a branch with a path in it',
      { branch: '../main' },
    ],
    [
      'a branch with a slash',
      { branch: 'feat/charts' },
    ],
    [
      'a short SHA',
      {
        sha: SHA.slice(0, 7),
      },
    ],
    [
      'a time that is not a number',
      { time: '2026-11-04' },
    ],
  ])('rejects %s', (_, extra) => {
    expect(() => parseUpload(commitUpload(extra))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})
