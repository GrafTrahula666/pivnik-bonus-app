import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, validateRuntimeConfig } from './config.js'
import { closePool } from './db.js'
import { purgeExpiredSessions } from './auth.js'
import { handleApi, sendApiError } from './router.js'
import { securityHeaders } from './security.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const staticRoot = path.resolve(projectRoot, config.staticDir)

const mime = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.json', 'application/json; charset=utf-8'],
])

async function serveStatic(res: http.ServerResponse, pathname: string): Promise<void> {
  const candidate = pathname === '/' ? '/index.html' : pathname
  const normalized = path.normalize(candidate).replace(/^(\.\.[/\\])+/, '')
  let filePath = path.resolve(staticRoot, `.${normalized}`)
  if (!filePath.startsWith(staticRoot)) {
    res.statusCode = 404
    res.end('Not found')
    return
  }
  try {
    const stat = await fs.stat(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
    const body = await fs.readFile(filePath)
    res.statusCode = 200
    securityHeaders(res)
    res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600')
    res.setHeader('Content-Type', mime.get(path.extname(filePath)) || 'application/octet-stream')
    res.end(body)
  } catch {
    // SPA fallback, never used for /api/admin/*.
    try {
      const body = await fs.readFile(path.join(staticRoot, 'index.html'))
      res.statusCode = 200
      securityHeaders(res)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(body)
    } catch {
      res.statusCode = 404
      securityHeaders(res)
      res.end('Admin frontend build not found. Run npm run build:web.')
    }
  }
}

validateRuntimeConfig()

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    if (await handleApi(req, res, url)) return
    if (url.pathname.startsWith('/api/')) {
      res.statusCode = 404
      securityHeaders(res)
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({
        error: 'This service exposes only /api/admin/*.',
        code: 'NON_ADMIN_API_REJECTED',
      }))
      return
    }
    await serveStatic(res, url.pathname)
  } catch (error) {
    if (String(req.url || '').startsWith('/api/admin/')) {
      sendApiError(res, error)
      return
    }
    console.error('Admin server error:', error)
    res.statusCode = 500
    securityHeaders(res)
    res.end('Admin Platform error')
  }
})

server.listen(config.port, '0.0.0.0', () => {
  console.log(`PIVNIK Admin Platform listening on ${config.port} (writes=${config.enableWrites}, bonusWrites=${config.enableProductionBonusWrites})`)
  void purgeExpiredSessions().catch((error) => {
    console.error('Admin session cleanup failed:', error instanceof Error ? error.message : error)
  })
})

const sessionCleanupTimer = setInterval(() => {
  void purgeExpiredSessions().catch((error) => {
    console.error('Admin session cleanup failed:', error instanceof Error ? error.message : error)
  })
}, 30 * 60 * 1000)
sessionCleanupTimer.unref()

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal}: shutting down Admin Platform`)
  clearInterval(sessionCleanupTimer)
  server.close(async () => {
    await closePool().catch(() => undefined)
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
