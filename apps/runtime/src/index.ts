import express from 'express'
import { assertRuntimeConfig, config } from './config.js'
import { registerDispatcherRoutes } from './dispatcher.js'
import { startAgentWorker, startIndexWorker } from './queue.js'

async function main(): Promise<void> {
  try {
    assertRuntimeConfig()
  } catch (e) {
    console.warn('[runtime] config incomplete, starting in degraded mode:', (e as Error).message)
  }

  const agentWorker = startAgentWorker()
  const indexWorker = startIndexWorker()

  const app = express()
  app.use(express.json())
  registerDispatcherRoutes(app)

  app.listen(config.port, () => {
    console.log(`[runtime] listening on :${config.port}`)
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
