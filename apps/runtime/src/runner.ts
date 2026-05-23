import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RunConfigJson } from '@bokito/shared'
import { config } from './config.js'
import { checkTokenBudget } from './budget.js'
import { completeRun, fetchRunContext } from './xano-client.js'

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
  let tokenInput = 0
  let tokenOutput = 0

  try {
    const ctx = await fetchRunContext(data.project_id, data.agent_id, workLogId).catch(() => ({}))

    const runConfig: RunConfigJson = {
      run_id: runId,
      project_id: data.project_id,
      tenant_id: data.tenant_id,
      work_log_id: workLogId,
      agent: {
        id: data.agent_id,
        name: String((ctx as { agent_name?: string }).agent_name || data.role),
        role: data.role as RunConfigJson['agent']['role'],
        model: String((ctx as { model?: string }).model || 'claude-sonnet-4'),
        system_prompt: String((ctx as { system_prompt?: string }).system_prompt || ''),
        max_loops: Number((ctx as { max_loops?: number }).max_loops || 25),
        tools: ((ctx as { tools?: RunConfigJson['agent']['tools'] }).tools) || [],
      },
      task: {
        thread_id: String((ctx as { thread_id?: string }).thread_id || randomUUID()),
        trigger_message_id: data.trigger_message_id || '',
        subject: String((ctx as { subject?: string }).subject || 'Agent run'),
        body: String((ctx as { body?: string }).body || ''),
        payload: ((ctx as { payload?: Record<string, unknown> }).payload) || {},
      },
      report_to: {
        type: 'user',
        id: String((ctx as { report_to_id?: string }).report_to_id || ''),
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
        pkb_url: `${config.xanoBaseUrl}/api:workforce/pkb`,
      },
    }

    const runConfigJson = JSON.stringify(runConfig)

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
        { stdio: 'inherit' }
      )
      child.on('error', reject)
      child.on('close', (code) => resolve(code ?? 1))
    })

    const usage = (ctx as { last_token_usage?: { input?: number; output?: number } }).last_token_usage
    tokenInput = usage?.input ?? 0
    tokenOutput = usage?.output ?? 0
  } catch (err) {
    exitCode = 1
    console.error('[runner] job failed', err)
  } finally {
    await completeRun(
      workLogId,
      {
        status: exitCode === 0 ? 'completed' : 'failed',
        token_input: tokenInput,
        token_output: tokenOutput,
      },
      runToken
    )
  }

  if (exitCode !== 0) {
    throw new Error(`docker exit ${exitCode}`)
  }
}
