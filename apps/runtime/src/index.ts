import express from 'express'
import { createBullBoard } from '@bull-board/api'
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter'
import { ExpressAdapter } from '@bull-board/express'
import { assertRuntimeConfig, config } from './config.js'
import { registerDispatcherRoutes } from './dispatcher.js'
import { agentQueue, indexQueue, startAgentWorker, startIndexWorker } from './queue.js'

function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header?.startsWith('Basic ')) return null
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 0) return null
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) }
  } catch {
    return null
  }
}

function bullBoardAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const expected = config.bullBoardBasicAuth
  if (!expected) {
    next()
    return
  }
  const [expUser, expPass] = expected.split(':')
  const creds = parseBasicAuth(req.headers.authorization)
  if (creds && creds.user === expUser && creds.pass === expPass) {
    next()
    return
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"')
  res.status(401).send('Unauthorized')
}

async function main(): Promise<void> {
  try {
    assertRuntimeConfig()
  } catch (e) {
    console.warn('[runtime] config incomplete, starting in degraded mode:', (e as Error).message)
  }

  const agentWorker = startAgentWorker()
  const indexWorker = startIndexWorker()

  const app = express()
  app.use(express.json({ limit: '10mb' }))
  registerDispatcherRoutes(app)

  const serverAdapter = new ExpressAdapter()
  serverAdapter.setBasePath('/admin/queues')
  createBullBoard({
    queues: [new BullMQAdapter(agentQueue), new BullMQAdapter(indexQueue)],
    serverAdapter,
  })
  app.use('/admin/queues', bullBoardAuth, serverAdapter.getRouter())

  app.listen(config.port, config.bindHost, () => {
    console.log(`[runtime] listening on ${config.bindHost}:${config.port}`)
  })

  const shutdown = async () => {
    await agentWorker.close()
    await indexWorker.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((err) => {
  console.error('[runtime] fatal', err)
  process.exit(1)
})
