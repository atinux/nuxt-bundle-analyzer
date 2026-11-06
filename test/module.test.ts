import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { clientSourceRoot, resolveSource } from '../src/module'

describe('resolveSource', () => {
  // A build like nuxt.com's: the maps sit three levels below the build directory.
  const buildDir = mkdtempSync(join(tmpdir(), 'nuxt-bundle-analyzer-'))
  const mapDir = join(buildDir, 'dist/client/_nuxt')
  mkdirSync(mapDir, { recursive: true })
  writeFileSync(join(buildDir, 'app.vue'), '<template />')

  it('drops a source that names a directory', () => {
    // What `extractAsyncDataHandlers` chunks list as their only source, read by Sonda as a file.
    expect(resolveSource('../../..', mapDir)).toBeNull()
  })

  it('resolves other sources against the source root', () => {
    expect(resolveSource('../../../app.vue', mapDir)).toBe(join(buildDir, 'app.vue'))
    expect(resolveSource('/no/such/file.ts', mapDir)).toBe('/no/such/file.ts')
  })
})

describe('clientSourceRoot', () => {
  // comark-docs: a layer at the repository root, built from `playground/` with the build directory in `node_modules/.cache`.
  const dirs = {
    buildDir: '/repo/playground/node_modules/.cache/nuxt/.nuxt',
    publicDir: '/repo/playground/.output/public',
  }

  it('resolves client sources from where Nuxt serves the maps, so a layer above rootDir is found', () => {
    // What Nuxt writes for `/repo/app/app.vue`: relative to `/repo/playground/.output/public/_nuxt`.
    const root = clientSourceRoot(`${dirs.buildDir}/dist/client/_nuxt`, dirs)
    expect(join(root, '../../../../app/app.vue')).toBe('/repo/app/app.vue')
  })

  it('leaves a source root outside the client build alone, as Nuxt 5 builds into the public directory', () => {
    expect(clientSourceRoot(`${dirs.publicDir}/_nuxt`, dirs)).toBe(`${dirs.publicDir}/_nuxt`)
  })
})
