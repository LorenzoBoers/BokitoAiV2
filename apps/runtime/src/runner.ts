import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RunConfigJson } from '@bokito/shared'
import { config } from './config.js'
import { checkTokenBudget } from './budget.js'
import { completeRun, fetchRunContext, postWorkLogEvent } from './xano-client.js'
import { fetchDocMap } from './docs/doc-map.js'

const STDERR_TAIL_BYTES = 2048

function tail(buf: string, max: number): string {
  if (buf.length <= max) return buf
  return buf.slice(buf.length - max)
}

export interface AgentJobData {
  project_id: string
  tenant_id: string
  agent_id: string
  role: string
  trigger_message_id?: string
  po_run?: boolean
  work_log_id: string
  run_id: string
  run_token: string
}

export async function processAgentJob(data: AgentJobData): Promise<void> {
  const budget = await checkTokenBudget(data.project_id)
  if (!budget.allowed) {
    console.warn(`[runner] budget blocked project=${data.project_id}`)
    await completeRun(data.work_log_id, { status: 'failed' }, data.run_token)
    return
  }

  const workLogId = data.work_log_id
  const runId = data.run_id
  const runToken = data.run_token

  let exitCode = 0

  try {
    const ctx = await fetchRunContext(data.project_id, data.agent_id, workLogId).catch(() => ({}))

    const ctxRecord = ctx as Record<string, unknown>

    const docMap = await fetchDocMap(data.tenant_id, data.project_id).catch(() => '')
    const runConfig: RunConfigJson = {
      run_id: runId,
      project_id: data.project_id,
      tenant_id: data.tenant_id,
      work_log_id: workLogId,
      project: {
        name: String(ctxRecord.project_name || ''),
        autonomous_scope: String(ctxRecord.project_autonomous_scope || ''),
      },
      agent: {
        id: data.agent_id,
        name: String(ctxRecord.agent_name || data.role),
        role: data.role as RunConfigJson['agent']['role'],
        model: String(ctxRecord.model || 'claude-sonnet-4'),
        system_prompt: String(ctxRecord.system_prompt || ''),
        max_loops: Number(ctxRecord.max_loops || 25),
        tools: (ctxRecord.tools as RunConfigJson['agent']['tools']) || [],
      },
      task: {
        thread_id: String(ctxRecord.thread_id || randomUUID()),
        trigger_message_id: data.trigger_message_id || '',
        subject: String(ctxRecord.subject || 'Agent run'),
        body: String(ctxRecord.body || ''),
        payload: (ctxRecord.payload as Record<string, unknown>) || {},
        change_queue_section_id:
          typeof ctxRecord.change_queue_section_id === 'string'
            ? ctxRecord.change_queue_section_id
            : null,
      },
      report_to: {
        type: 'user',
        id: String(ctxRecord.report_to_id || ''),
      },
      budget: {
        remaining_today: budget.remainingToday,
        remaining_hour: budget.remainingHour,
      },
      xano: {
        base_url: config.xanoBaseUrl,
        work_log_url: `${config.xanoBaseUrl}/api:workforce/work_logs/${workLogId}/events`,
        messages_url: `${config.xanoBaseUrl}/api:workforce/messages/worker`,
        search_index_url: `${config.xanoBaseUrl}/api:workforce/index/search`,
        doc_blocks_worker_url: `${config.xanoBaseUrl}/api:integrations/doc/worker/blocks`,
        doc_reindex_page_url: `${config.xanoBaseUrl}/api:integrations/doc/worker/reindex-page`,
        doc_map: docMap,
      },
    }

    const runConfigJson = JSON.stringify(runConfig)

    let stderrBuf = ''
    exitCode = await new Promise<number>((resolve, reject) => {
      const imageTag =
        data.role === 'testing' ? config.dockerImageTagPlaywright : config.dockerImageTag
      const child = spawn(
        'docker',
        [
          'run',
          '--rm',
          '--add-host=host.docker.internal:host-gateway',
          '--read-only',
          '--tmpfs',
          '/tmp:rw,noexec,nosuid,size=256m',
          '-e',
          `RUN_CONFIG_JSON=${runConfigJson}`,
          '-e',
          `ANTHROPIC_API_KEY=${config.anthropicApiKey || ''}`,
          '-e',
          `XANO_RUN_TOKEN=${runToken}`,
          '-e',
          `OLLAMA_BASE_URL=http://host.docker.internal:11434`,
          '-e',
          `OLLAMA_EMBEDDING_MODEL=${config.ollamaEmbeddingModel}`,
          imageTag,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      child.stdout?.on('data', (chunk: Buffer) => {
        process.stdout.write(chunk)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        process.stderr.write(chunk)
        stderrBuf = tail(stderrBuf + chunk.toString('utf8'), STDERR_TAIL_BYTES)
      })
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 1))
    })

    if (exitCode !== 0) {
      await postWorkLogEvent(
        workLogId,
        {
          type: 'error',
          title: 'startup_failed',
          body: `Container exited with code ${exitCode}.`,
          payload: { exit_code: exitCode, stderr: stderrBuf || '<no stderr captured>' },
        },
        runToken
      ).catch((e) => console.warn('[runner] postWorkLogEvent failed', (e as Error).message))
    }
  } catch (err) {
    exitCode = 1
    console.error('[runner] job failed', err)
    await postWorkLogEvent(
      workLogId,
      {
        type: 'error',
        title: 'startup_failed',
        body: `Runner threw before docker exit: ${(err as Error).message}`,
        payload: { error: (err as Error).message },
      },
      runToken
    ).catch((e) => console.warn('[runner] postWorkLogEvent failed', (e as Error).message))
  } finally {
    await completeRun(
      workLogId,
      {
        status: exitCode === 0 ? 'completed' : 'failed',
      },
      runToken
    )
  }

  if (exitCode !== 0) {
    throw new Error(`docker exit ${exitCode}`)
  }
}
