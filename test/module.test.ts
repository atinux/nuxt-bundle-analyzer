import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveSource } from '../src/module'

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
