import Anthropic from '@anthropic-ai/sdk'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const ALLOWED_SHELL = {
  coding: new Set(['npm run lint', 'npm run typecheck']),
  testing: new Set(['npm test', 'npx vitest run', 'npx jest --ci', 'npx playwright test']),
}

const TOOLS_COMMON = [
  {
    name: 'log',
    description: 'Post a plain-language internal log line. Visible to staff in the run detail page, NOT to the end user. Use this to summarise what you did this run.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short plain-language title' },
        body: { type: 'string', description: 'Optional detail in plain language' },
      },
      required: ['title'],
    },
  },
]

const TOOLS_PO = [
  {
    name: 'write_doc',
    description:
      "Apply a batch of block ops to a project doc page. The doc map is in your system context (page_id + slug per page). Every op is recorded in the audit trail with your agent role as actor and the change_note you provide. Use this to update the project's documentation directly when you have new information, instead of asking the user. Required: page_id, change_note explaining why. Op shapes: {op:'create', type, text:[{text:'…'}], position}, {op:'update', id, text}, {op:'move', id, position}, {op:'delete', id}.",
    input_schema: {
      type: 'object',
      properties: {
        page_id: { type: 'string', description: 'Target doc_pages.id (from doc_map)' },
        change_note: {
          type: 'string',
          description: 'One-sentence rationale; appears in the page revision history',
        },
        ops: {
          type: 'array',
          items: { type: 'object' },
          description: "Array of block ops. See description for shapes.",
        },
      },
      required: ['page_id', 'change_note', 'ops'],
    },
  },
  {
    name: 'read_doc_page',
    description:
      'Read the current ordered block list of a project doc page so you can decide what to update. Use this when a doc map heading is not enough.',
    input_schema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
      },
      required: ['page_id'],
    },
  },
  {
    name: 'write_decision_request',
    description:
      'Send a decision_request message to the user when you need them to choose between options or answer a clarifying question. Subject must be one short sentence. Body must be plain language under 100 words. Provide 2-3 concrete options.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Short labels of the choices the user can pick',
        },
      },
      required: ['subject', 'body'],
    },
  },
  {
    name: 'write_status_update',
    description:
      'Send a status_update message to the user. Use this to acknowledge a change request you understood, describe what you noticed, or summarise progress. Plain language, under 100 words. No code, no jargon, no file paths.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['subject', 'body'],
    },
  },
]

const TOOLS_CODING = [
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

function toolsForRole(role) {
  if (role === 'po') return [...TOOLS_COMMON, ...TOOLS_PO]
  if (role === 'coding' || role === 'testing') return [...TOOLS_COMMON, ...TOOLS_CODING]
  return [...TOOLS_COMMON, ...TOOLS_PO, ...TOOLS_CODING]
}

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

async function postRunComplete(cfg, status, tokenUsage) {
  const base = cfg.xano?.base_url
  if (!base) return
  const url = `${String(base).replace(/\/$/, '')}/api:workforce/runs/complete`
  await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(
      authBody({
        work_log_id: cfg.work_log_id,
        status,
        token_input: tokenUsage.input,
        token_output: tokenUsage.output,
      })
    ),
  }).catch((e) => console.error('[agent-loop] postRunComplete', e.message))
}

async function postTaskResult(cfg, body, tokenUsage) {
  const url = cfg.xano?.messages_url
  if (!url) return
  const payload = {
    project_id: cfg.project_id,
    tenant_id: cfg.tenant_id,
    thread_id: cfg.task.thread_id,
    from_id: cfg.agent.id,
    body,
    status: 'done',
    payload: JSON.stringify({
      work_log_id: cfg.work_log_id,
      run_id: cfg.run_id,
      token_input: tokenUsage.input,
      token_output: tokenUsage.output,
    }),
  }
  if (cfg.task.trigger_message_id) {
    payload.parent_message_id = cfg.task.trigger_message_id
  }
  if (cfg.task.subject) {
    payload.subject = cfg.task.subject
  }
  if (cfg.report_to?.type && cfg.report_to?.id) {
    payload.to_type = cfg.report_to.type
    payload.to_id = cfg.report_to.id
  }
  await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(authBody(payload)),
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

async function writeDoc(cfg, { page_id, change_note, ops } = {}) {
  const url = cfg.xano?.doc_blocks_worker_url
  if (!url) return { error: 'doc_blocks_worker_url not configured' }
  if (!page_id) return { error: 'page_id required' }
  if (!change_note) return { error: 'change_note required' }
  if (!Array.isArray(ops) || ops.length === 0) return { error: 'ops required' }
  const body = {
    token: process.env.XANO_RUN_TOKEN || '',
    tenant_id: cfg.tenant_id,
    project_id: cfg.project_id,
    page_id,
    agent_id: cfg.agent.id,
    actor_label: cfg.agent.name || cfg.agent.role,
    change_note,
    ops,
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch((e) => ({ ok: false, status: 0, message: e.message }))
  if (!res.ok) {
    const text = await (res.text ? res.text() : Promise.resolve('')).catch(() => '')
    return { error: `write_doc failed (${res.status || 'network'})`, detail: truncate(text, 300) }
  }
  const data = await res.json()
  return { ok: true, applied: (data.applied ?? []).length, page_id: data.page_id }
}

async function readDocPage(cfg, { page_id } = {}) {
  const url = cfg.xano?.doc_reindex_page_url
  if (!url) return { error: 'doc_reindex_page_url not configured' }
  if (!page_id) return { error: 'page_id required' }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: process.env.XANO_RUN_TOKEN || '',
      tenant_id: cfg.tenant_id,
      project_id: cfg.project_id,
      page_id,
    }),
  }).catch((e) => ({ ok: false, status: 0, message: e.message }))
  if (!res.ok) {
    return { error: `read_doc_page failed (${res.status || 'network'})` }
  }
  const data = await res.json()
  const blocks = (data.blocks ?? []).map((b) => ({
    id: b.id,
    type: b.type,
    parent_block_id: b.parent_block_id,
    position: b.position,
    text: Array.isArray(b.text) ? b.text.map((r) => r?.text ?? '').join('') : '',
  }))
  return { page: data.page, blocks }
}

async function postUserMessage(cfg, { message_type, status, subject, body, payload }) {
  const url = cfg.xano?.messages_url
  if (!url) return { error: 'messages_url not configured' }
  if (!body || !String(body).trim()) return { error: 'body required' }
  const out = {
    project_id: cfg.project_id,
    tenant_id: cfg.tenant_id,
    thread_id: cfg.task.thread_id,
    from_id: cfg.agent.id,
    body: String(body),
    message_type,
    status,
    channel: 'internal',
  }
  if (subject) out.subject = String(subject)
  if (cfg.report_to?.type && cfg.report_to?.id) {
    out.to_type = cfg.report_to.type
    out.to_id = cfg.report_to.id
  }
  if (payload) out.payload = JSON.stringify(payload)
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(authBody(out)),
  }).catch((e) => ({ ok: false, status: 0, message: e.message }))
  if (!res.ok) {
    const text = await (res.text ? res.text() : Promise.resolve('')).catch(() => '')
    return { error: `${message_type} failed (${res.status || 'network'})`, detail: truncate(text, 300) }
  }
  const data = await res.json()
  return { ok: true, message_id: data.id, message_type }
}

async function writeDecisionRequest(cfg, { subject, body, options } = {}) {
  return postUserMessage(cfg, {
    message_type: 'decision_request',
    status: 'awaiting_human',
    subject,
    body,
    payload: Array.isArray(options) && options.length ? { options } : undefined,
  })
}

async function writeStatusUpdate(cfg, { subject, body } = {}) {
  return postUserMessage(cfg, {
    message_type: 'status_update',
    status: 'done',
    subject,
    body,
  })
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
    case 'write_doc':
      return writeDoc(cfg, input || {})
    case 'read_doc_page':
      return readDocPage(cfg, input || {})
    case 'write_decision_request':
      return writeDecisionRequest(cfg, input || {})
    case 'write_status_update':
      return writeStatusUpdate(cfg, input || {})
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

function renderTemplate(template, vars) {
  if (!template) return ''
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const parts = key.split('.')
    let cur = vars
    for (const p of parts) {
      if (cur == null) return ''
      cur = cur[p]
    }
    return cur == null ? '' : String(cur)
  })
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

  const tools = toolsForRole(cfg.agent.role)
  const baseSystem = renderTemplate(
    cfg.agent.system_prompt || 'You are a helpful agent. Use tools when needed.',
    {
      project: cfg.project || { name: '', autonomous_scope: '' },
      agent: cfg.agent,
    }
  )
  const docMap = cfg.xano?.doc_map ? `\n\n${cfg.xano.doc_map}\n\nWhen you write to the doc, pass the page_id from the doc map and a one-sentence change_note explaining why.` : ''
  const renderedSystem = `${baseSystem}${docMap}`

  const initialUser = cfg.task.body && String(cfg.task.body).trim()
    ? `subject: ${cfg.task.subject}\n\nbody:\n${cfg.task.body}`
    : `subject: ${cfg.task.subject}\n\nbody: (empty — this is a scheduled check)`

  const messages = [
    {
      role: 'user',
      content: initialUser,
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
        system: renderedSystem,
        tools,
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
  await postRunComplete(cfg, unrecoverable ? 'failed' : 'completed', {
    input: tokenInput,
    output: tokenOutput,
  })
  process.exit(unrecoverable ? 2 : 0)
}

main().catch(async (err) => {
  console.error('[agent-loop]', err)
  process.exit(1)
})
