import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)

const ALLOWED_SHELL = {
  coding: new Set(['npm run lint', 'npm run typecheck']),
  testing: new Set(['npm test', 'npx vitest run', 'npx jest --ci', 'npx playwright test']),
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

async function postEvent(cfg, event) {
  const url = cfg.xano?.work_log_url
  if (!url) return
  const token = process.env.XANO_RUN_TOKEN || ''
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ events: [event] }),
  }).catch((e) => console.error('[agent-loop] postEvent', e.message))
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

async function executeTool(cfg, name, input) {
  switch (name) {
    case 'log':
      await postEvent(cfg, { type: 'log', title: input.title, body: input.body })
      return { ok: true }
    case 'run_shell':
      return runShell(cfg, input)
    default:
      return { error: `unknown_tool:${name}` }
  }
}

async function main() {
  const cfg = loadConfig()
  await postEvent(cfg, {
    type: 'log',
    title: 'Run started',
    body: `${cfg.agent.name} (${cfg.agent.role})`,
  })

  const maxLoops = cfg.agent.max_loops || 25
  for (let i = 0; i < maxLoops; i++) {
    await postEvent(cfg, { type: 'think', title: `Loop ${i + 1}`, body: cfg.task.subject })
    if (i === 0 && cfg.agent.role === 'coding') {
      await executeTool(cfg, 'run_shell', { command: 'npm run typecheck', cwd: '/work' })
    }
    if (i >= 1) break
  }

  await postEvent(cfg, {
    type: 'log',
    title: 'Run finished',
    body: 'Agent loop completed (stub implementation).',
  })
  process.exit(0)
}

main().catch(async (err) => {
  console.error('[agent-loop]', err)
  process.exit(1)
})
