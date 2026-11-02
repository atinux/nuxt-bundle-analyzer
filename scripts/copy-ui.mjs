// Ships the generated viewer with the package, so `serve` needs nothing else to show it.
import { cp, rm } from 'node:fs/promises'

const from = new URL('../viewer/.output-static/public/', import.meta.url)
const to = new URL('../dist/ui/', import.meta.url)
await rm(to, { recursive: true, force: true })
await cp(from, to, { recursive: true })
