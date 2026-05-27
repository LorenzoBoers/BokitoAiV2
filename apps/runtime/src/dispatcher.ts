import { timingSafeEqual } from 'node:crypto'
import type { Express, Request, Response } from 'express'
import { agentQueue, indexQueue } from './queue.js'
import { processRepoReindex } from './github/reindex.js'
import { processTenantDocsIndex } from './docs/reindex.js'
import { scheduleDocPageReindex } from './docs/reindex-coalesce.js'
import { config } from './config.js'
import { checkTokenBudget } from './budget.js'
import { startRun } from './xano-client.js'

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

function inboundAuthFailed(req: Request): boolean {
  if (!config.workerInboundSecret) return true
  if (!req.headers.authorization) return true
  return !bearerMatches(req)
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
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
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

    let started
    try {
      started = await startRun({
        project_id: String(project_id),
        tenant_id: String(tenant_id),
        agent_id: String(agent_id),
        trigger_message_id: trigger_message_id ? String(trigger_message_id) : undefined,
      })
    } catch (e) {
      res.status(502).json({ error: 'xano_start_failed', detail: (e as Error).message })
      return
    }

    await agentQueue.add('run', {
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      agent_id: String(agent_id),
      role: String(role),
      trigger_message_id: trigger_message_id ? String(trigger_message_id) : undefined,
      work_log_id: started.work_log_id,
      run_id: started.run_id,
      run_token: started.run_token,
    })

    res.json({ run_id: started.run_id, work_log_id: started.work_log_id })
  })

  app.post('/agent/po/run', async (req: Request, res: Response) => {
    const ip = req.ip || 'unknown'
    if (!rateLimit(ip)) {
      res.status(429).json({ error: 'rate_limited' })
      return
    }
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, po_agent_id } = req.body || {}
    if (!project_id || !tenant_id || !po_agent_id) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    let started
    try {
      started = await startRun({
        project_id: String(project_id),
        tenant_id: String(tenant_id),
        agent_id: String(po_agent_id),
        task_subject: 'PO heartbeat run',
      })
    } catch (e) {
      res.status(502).json({ error: 'xano_start_failed', detail: (e as Error).message })
      return
    }

    await agentQueue.add('po', {
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      agent_id: String(po_agent_id),
      role: 'po',
      po_run: true,
      work_log_id: started.work_log_id,
      run_id: started.run_id,
      run_token: started.run_token,
    })

    res.json({ run_id: started.run_id, work_log_id: started.work_log_id })
  })

  app.post('/index/run', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, file_path, content, source_type } = req.body || {}
    if (!project_id || !tenant_id || !file_path || !content) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    const job = await indexQueue.add('index', {
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      file_path: String(file_path),
      content: String(content),
      source_type: source_type ? String(source_type) : undefined,
    })

    res.json({ job_id: job.id, queued: true })
  })

  app.post('/index/tenant-docs', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, doc_id, sections } = req.body || {}
    if (!project_id || !tenant_id || !doc_id || !Array.isArray(sections)) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    void processTenantDocsIndex({
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      doc_id: String(doc_id),
      sections,
    }).catch((err) => {
      console.error('[index/tenant-docs]', doc_id, err)
    })

    res.json({ queued: true, doc_id })
  })

  app.post('/doc/reindex-page', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id, page_id, changed_block_ids } = req.body || {}
    if (!project_id || !tenant_id || !page_id) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    scheduleDocPageReindex({
      scope: 'project',
      project_id: String(project_id),
      tenant_id: String(tenant_id),
      page_id: String(page_id),
      changed_block_ids: Array.isArray(changed_block_ids)
        ? changed_block_ids.map(String)
        : undefined,
    })

    res.json({ queued: true, page_id })
  })

  app.post('/workspace/doc/reindex-page', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { workspace_doc_id, tenant_id, page_id, changed_block_ids } = req.body || {}
    if (!workspace_doc_id || !tenant_id || !page_id) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    scheduleDocPageReindex({
      scope: 'workspace',
      workspace_doc_id: String(workspace_doc_id),
      tenant_id: String(tenant_id),
      page_id: String(page_id),
      changed_block_ids: Array.isArray(changed_block_ids)
        ? changed_block_ids.map(String)
        : undefined,
    })

    res.json({ queued: true, page_id })
  })

  app.post('/repo/reindex', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(req.headers.authorization ? 401 : 403).json({ error: 'unauthorized' })
      return
    }

    const { project_id, tenant_id } = req.body || {}
    if (!project_id || !tenant_id) {
      res.status(400).json({ error: 'missing_fields' })
      return
    }

    void processRepoReindex(String(project_id), String(tenant_id)).catch((err) => {
      console.error('[repo/reindex]', project_id, err)
    })

    res.json({ queued: true, project_id, tenant_id })
  })

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'bokito-runtime' })
  })
}
