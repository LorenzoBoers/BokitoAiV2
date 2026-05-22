import { timingSafeEqual } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { agentQueue } from './queue.js'
import { config } from './config.js'
import { checkTokenBudget } from './budget.js'

function bearerMatches(req: Request): boolean {
  const header = req.headers.authorization || ''
  const expected = `Bearer ${config.workerInboundSecret}`
  if (header.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  } catch {
    return false
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + 60_000 }
  if (now > bucket.resetAt) {
    bucket.count = 0
    bucket.resetAt = now + 60_000
  }
  bucket.count += 1
  rateBuckets.set(ip, bucket)
  return bucket.count <= 60
}

export function registerDispatcherRoutes(app: Express): void {
  app.post('/agent/run', async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown'
    if (!rateLimit(ip)) {
      res.status(429).json({ error: 'rate_limited' })
      return
    }
    if (!config.workerInboundSecret) {
      res.status(503).json({ error: 'not_configured' })
      return
    }
    if (!req.headers.authorization) {
      res.status(403).json({ error: 'missing_auth' })
      return
    }
    if (!bearerMatches(req)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, agent_id, role, trigger_message_id } = req.body || {}
    if (!project_id || !tenant_id || !agent_id || !role) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    const budget = await checkTokenBudget(String(project_id))
    if (!budget.allowed) {
      res.status(402).json({ error: 'budget_exceeded' })
      return
    }

    const job = await agentQueue.add('run', {
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      agent_id: String(agent_id),
      role: String(role),
      trigger_message_id: trigger_message_id ? String(trigger_message_id) : undefined,
    })

    res.json({ run_id: job.id, work_log_id: job.id })
  })

  app.post('/agent/po/run', async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown'
    if (!rateLimit(ip)) {
      res.status(429).json({ error: 'rate_limited' })
      return
    }
    if (!req.headers.authorization || !bearerMatches(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, po_agent_id } = req.body || {}
    if (!project_id || !tenant_id || !po_agent_id) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    const job = await agentQueue.add('po', {
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      agent_id: String(po_agent_id),
      role: 'po',
      po_run: true,
    })

    res.json({ run_id: job.id, work_log_id: job.id })
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
}
