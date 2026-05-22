import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { RunConfigJson } from '@bokito/shared'
import { config } from './config.js'
import { checkTokenBudget } from './budget.js'
import { fetchRunContext } from './xano-client.js'

export interface AgentJobData {
  project_id: string
  tenant_id: string
  agent_id: string
  role: string
  trigger_message_id?: string
  po_run?: boolean
}

export async function processAgentJob(data: AgentJobData): Promise<void> {
  const budget = await checkTokenBudget(data.project_id)
  if (!budget.allowed) {
    console.warn(`[runner] budget blocked project=${data.project_id}`)
    return
  }

  const runId = randomUUID()
  const workLogId = randomUUID()
  const ctx = await fetchRunContext(data.project_id, data.agent_id).catch(() => ({}))

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
      messages_url: `${config.xanoBaseUrl}/api:workforce/messages`,
      search_index_url: `${config.xanoBaseUrl}/api:workforce/index/search`,
      pkb_url: `${config.xanoBaseUrl}/api:workforce/pkb`,
    },
  }

  const env = {
    ...process.env,
    RUN_CONFIG_JSON: JSON.stringify(runConfig),
    ANTHROPIC_API_KEY: config.anthropicApiKey,
    XANO_RUN_TOKEN: String((ctx as { run_token?: string }).run_token || ''),
  }

  await new Promise<void>((resolve, reject) => {
    const imageTag =
      data.role === 'testing' ? config.dockerImageTagPlaywright : config.dockerImageTag
    const child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=256m',
        '-e',
        `RUN_CONFIG_JSON=${env.RUN_CONFIG_JSON}`,
        '-e',
        `ANTHROPIC_API_KEY=${env.ANTHROPIC_API_KEY || ''}`,
        '-e',
        `XANO_RUN_TOKEN=${env.XANO_RUN_TOKEN || ''}`,
        imageTag,
      ],
      { stdio: 'inherit' }
    )
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`docker exit ${code}`))
    })
  })
}
