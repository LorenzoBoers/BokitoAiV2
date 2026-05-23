import Anthropic from '@anthropic-ai/sdk'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const ALLOWED_SHELL = {
  coding: new Set(['npm run lint', 'npm run typecheck']),
  testing: new Set(['npm test', 'npx vitest run', 'npx jest --ci', 'npx playwright test']),
}

const TOOLS = [
  {
    name: 'log',
    description: 'Post a plain-language status update visible to the user.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short plain-language title' },
        body: { type: 'string', description: 'Optional detail in plain language' },
      },
      required: ['title'],
    },
  },
  {
    name: 'run_shell',
    description: 'Run an allowlisted shell command in the project workspace.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        cwd: { type: 'string' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_index',
    description: 'Search the project code and knowledge index before reading files.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        top_k: { type: 'number' },
      },
      required: ['query'],
    },
  },
]

function truncate(s, max) {
  const t = String(s ?? '')
  if (t.length <= max) return t
  return t.slice(0, max) + '[TRUNCATED]'
}

function loadConfig() {
  const raw = process.env.RUN_CONFIG_JSON
  if (!raw) throw new Error('RUN_CONFIG_JSON missing')
  return JSON.parse(raw)
}

function authHeaders() {
  const token = process.env.XANO_RUN_TOKEN || ''
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function authBody(extra = {}) {
  const token = process.env.XANO_RUN_TOKEN || ''
  return { auth_token: token, ...extra }
}

async function postEvent(cfg, event) {
  const url = cfg.xano?.work_log_url
  if (!url) return
  await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(authBody({ events: [event] })),
  }).catch((e) => console.error('[agent-loop] postEvent', e.message))
}

async function postTaskResult(cfg, body, tokenUsage) {
  const url = cfg.xano?.messages_url
  if (!url) return
  await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(
      authBody({
        project_id: cfg.project_id,
        tenant_id: cfg.tenant_id,
        thread_id: cfg.task.thread_id,
        parent_message_id: cfg.task.trigger_message_id || null,
        from_type: 'agent',
        from_id: cfg.agent.id,
        to_type: cfg.report_to?.type || 'user',
        to_id: cfg.report_to?.id || null,
        channel: 'internal',
        message_type: 'task_result',
        subject: cfg.task.subject,
        body,
        status: 'done',
        payload: {
          work_log_id: cfg.work_log_id,
          run_id: cfg.run_id,
          token_input: tokenUsage.input,
          token_output: tokenUsage.output,
        },
      })
    ),
  }).catch((e) => console.error('[agent-loop] postTaskResult', e.message))
}

async function runShell(cfg, { command, cwd }) {
  const allow = ALLOWED_SHELL[cfg.agent.role]
  const trimmed = String(command || '').trim()
  if (!allow || !allow.has(trimmed)) {
    return {
      exit_code: -1,
      stdout: '',
      stderr: `ERROR: command not on allowlist for role ${cfg.agent.role}`,
    }
  }
  try {
    const { stdout, stderr } = await execAsync(trimmed, {
      cwd: cwd || '/work',
      timeout: 120_000,
      killSignal: 'SIGKILL',
      maxBuffer: 8 * 1024 * 1024,
    })
    return {
      exit_code: 0,
      stdout: truncate(stdout, 4000),
      stderr: truncate(stderr, 4000),
    }
  } catch (e) {
    return {
      exit_code: e.killed ? -1 : e.code ?? 1,
      stdout: truncate(e.stdout, 4000),
      stderr: truncate(e.stderr || (e.killed ? 'TIMEOUT' : e.message), 4000),
    }
  }
}

async function embedQuery(query) {
  const base = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434'
  const model = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text-v2-moe'
  const res = await fetch(`${base}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: `search_query: ${query}` }),
  })
  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status}`)
  }
  const data = await res.json()
  if (!data.embedding?.length) throw new Error('Empty embedding from Ollama')
  return data.embedding
}

async function searchIndex(cfg, { query, top_k = 8 }) {
  const url = cfg.xano?.search_index_url
  if (!url) return { results: [], error: 'search_index_url not configured' }
  let embedding
  try {
    embedding = await embedQuery(query)
  } catch (e) {
    return { results: [], error: e.message }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(
      authBody({
        project_id: cfg.project_id,
        embedding,
        top_k,
      })
    ),
  }).catch((e) => ({ ok: false, status: 0, message: e.message }))
  if (!res.ok) {
    return { results: [], error: `search failed (${res.status || 'network'})` }
  }
  const data = await res.json()
  return data.results ? data : { results: data.chunks ?? data.items ?? [] }
}

async function executeTool(cfg, name, input) {
  switch (name) {
    case 'log':
      await postEvent(cfg, { type: 'log', title: input.title, body: input.body })
      return { ok: true }
    case 'run_shell':
      return runShell(cfg, input)
    case 'search_index':
      return searchIndex(cfg, input)
    default:
      return { error: `unknown_tool:${name}` }
  }
}

function resolveModel(model) {
  const m = String(model || 'claude-sonnet-4')
  if (m.includes('-202')) return m
  if (m === 'claude-sonnet-4') return 'claude-sonnet-4-20250514'
  if (m === 'claude-opus-4') return 'claude-opus-4-20250514'
  if (m === 'claude-haiku-4') return 'claude-haiku-4-20250514'
  return m
}

async function main() {
  const cfg = loadConfig()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[agent-loop] ANTHROPIC_API_KEY missing')
    process.exit(1)
  }

  const anthropic = new Anthropic({ apiKey })
  let tokenInput = 0
  let tokenOutput = 0
  let finalText = ''
  let unrecoverable = false

  await postEvent(cfg, {
    type: 'log',
    title: 'Run started',
    body: `${cfg.agent.name} (${cfg.agent.role})`,
  })

  const messages = [
    {
      role: 'user',
      content: `Task: ${cfg.task.subject}\n\n${cfg.task.body || ''}`.trim(),
    },
  ]

  const maxLoops = cfg.agent.max_loops || 25

  for (let i = 0; i < maxLoops; i++) {
    await postEvent(cfg, { type: 'think', title: `Loop ${i + 1}`, body: cfg.task.subject })

    let response
    try {
      response = await anthropic.messages.create({
        model: resolveModel(cfg.agent.model),
        max_tokens: 8192,
        system: cfg.agent.system_prompt || 'You are a helpful agent. Use tools when needed.',
        tools: TOOLS,
        messages,
      })
    } catch (err) {
      await postEvent(cfg, {
        type: 'error',
        title: 'LLM call failed',
        body: truncate(err.message, 500),
      })
      process.exit(1)
    }

    tokenInput += response.usage?.input_tokens ?? 0
    tokenOutput += response.usage?.output_tokens ?? 0

    const toolUses = response.content.filter((b) => b.type === 'tool_use')
    const textBlocks = response.content.filter((b) => b.type === 'text')

    if (textBlocks.length) {
      finalText = textBlocks.map((b) => b.text).join('\n').trim()
    }

    if (toolUses.length === 0) {
      break
    }

    messages.push({ role: 'assistant', content: response.content })

    const toolResults = []
    for (const tu of toolUses) {
      await postEvent(cfg, {
        type: 'tool_call',
        title: tu.name,
        payload: tu.input,
      })

      let result
      try {
        result = await executeTool(cfg, tu.name, tu.input)
      } catch (err) {
        result = { error: truncate(err.message, 500) }
        unrecoverable = true
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      })
    }

    messages.push({ role: 'user', content: toolResults })

    if (unrecoverable) break
  }

  const summary = finalText || 'Task completed.'
  await postEvent(cfg, {
    type: 'log',
    title: 'Run finished',
    body: summary,
  })

  await postTaskResult(cfg, summary, { input: tokenInput, output: tokenOutput })
  process.exit(unrecoverable ? 2 : 0)
}

main().catch(async (err) => {
  console.error('[agent-loop]', err)
  process.exit(1)
})
