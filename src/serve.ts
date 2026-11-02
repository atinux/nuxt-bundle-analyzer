import type { Buffer } from 'node:buffer'
import type { AddressInfo } from 'node:net'

import { promises as fsp } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join } from 'pathe'

import { listRuns, RUN_FILES, toSlug } from './runs'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export interface ServeOptions {
  runsDir: string
  /** The generated viewer, shipped in the package. */
  uiDir: string
  port: number
  hostname: string
  /** Other hosts the server answers, such as a tunnel's; a leading dot allows subdomains. */
  allowedHosts: string[]
  /** The run marked as the latest, by default the newest. */
  current?: string
}

/** Serves the viewer and the runs it reads from `/data`. Resolves with the URL it listens on. */
export async function serve(options: ServeOptions): Promise<string> {
  const indexHtml = await fsp.readFile(join(options.uiDir, 'index.html'))
  const allowed = new Set([
    'localhost',
    '127.0.0.1',
    '[::1]',
    options.hostname,
    ...options.allowedHosts,
  ].map(host => host.toLowerCase()))
  // Only the hosts it was started for, so a page on another site cannot read the reports through DNS rebinding.
  const isAllowed = (host: string | undefined) => {
    const name = host?.toLowerCase().replace(/:\d+$/, '')
    return !!name && (allowed.has(name) || [...allowed].some(entry => entry.startsWith('.') && name.endsWith(entry)))
  }

  const server = createServer(async (request, response) => {
    const send = (status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'content-type': type })
      response.end(body)
    }
    if (!isAllowed(request.headers.host)) {
      return send(403, 'Forbidden: this host is not allowed.')
    }
    // `URL` resolves `..` segments, so paths below cannot leave the directories they are joined to.
    const { pathname } = new URL(request.url ?? '/', 'http://localhost')

    if (pathname === '/data/runs.json') {
      const runs = await listRuns(options.runsDir)
      const current = options.current ?? runs[0]?.slug
      return send(200, JSON.stringify(runs.map(run => ({ ...run, current: run.slug === current }))), CONTENT_TYPES['.json'])
    }
    if (pathname.startsWith('/data/')) {
      const [slug, file, ...rest] = pathname.slice('/data/'.length).split('/')
      // Only the run directories and files the viewer reads, so nothing else in the project is reachable.
      if (!slug || toSlug(slug) !== slug || !file || !RUN_FILES.includes(file) || rest.length > 0) {
        return send(404, 'Not found')
      }
      return fsp.readFile(join(options.runsDir, slug, file)).then(
        contents => send(200, contents, CONTENT_TYPES['.json']),
        () => send(404, 'Not found'),
      )
    }
    const type = CONTENT_TYPES[extname(pathname)]
    if (type) {
      return fsp.readFile(join(options.uiDir, pathname)).then(
        contents => send(200, contents, type),
        () => send(404, 'Not found'),
      )
    }
    // A single-page app: every other path renders it.
    send(200, indexHtml, CONTENT_TYPES['.html'])
  })

  // The requested port, or the next free one.
  for (let port = options.port; ; port++) {
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, options.hostname, () => {
          server.off('error', reject)
          resolve()
        })
      })
      break
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || port >= options.port + 100) {
        throw error
      }
    }
  }
  const { port } = server.address() as AddressInfo
  return `http://${options.hostname}:${port}/`
}
