import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { config } from '../config.js'

const execFileAsync = promisify(execFile)

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  'vendor',
  '__pycache__',
])

const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.txt',
  '.yaml',
  '.yml',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.sql',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.sh',
  '.env.example',
])

export function projectRepoDir(projectId: string): string {
  return join(config.repoCloneDir, projectId)
}

export async function cloneOrPull(
  projectId: string,
  repoFullName: string,
  branch: string,
  accessToken: string,
): Promise<string> {
  const dir = projectRepoDir(projectId)
  await mkdir(config.repoCloneDir, { recursive: true })
  const cloneUrl = `https://x-access-token:${accessToken}@github.com/${repoFullName}.git`

  try {
    await stat(join(dir, '.git'))
    await execFileAsync('git', ['-C', dir, 'fetch', 'origin'], { timeout: 120_000 })
    await execFileAsync('git', ['-C', dir, 'checkout', branch], { timeout: 30_000 })
    await execFileAsync('git', ['-C', dir, 'pull', '--ff-only', 'origin', branch], { timeout: 120_000 })
  } catch {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', branch, cloneUrl, dir], {
      timeout: 180_000,
    })
  }

  const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 10_000 })
  return stdout.trim()
}

async function walkFiles(root: string, dir = root): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      files.push(...(await walkFiles(root, join(dir, entry.name))))
      continue
    }
    if (!entry.isFile()) continue
    const ext = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : ''
    if (!TEXT_EXTENSIONS.has(ext.toLowerCase()) && ext !== '') continue
    files.push(join(dir, entry.name))
  }

  return files
}

export async function readRepoTextFiles(projectId: string): Promise<Array<{ path: string; content: string }>> {
  const root = projectRepoDir(projectId)
  const absPaths = await walkFiles(root)
  const out: Array<{ path: string; content: string }> = []

  for (const abs of absPaths) {
    try {
      const st = await stat(abs)
      if (st.size > 512_000) continue
      const content = await readFile(abs, 'utf8')
      if (!content.trim()) continue
      out.push({ path: relative(root, abs).replace(/\\/g, '/'), content })
    } catch {
      // skip unreadable files
    }
  }

  return out
}

export async function fetchLatestCommitSha(
  repoFullName: string,
  branch: string,
  accessToken: string,
): Promise<string | null> {
  const [owner, repo] = repoFullName.split('/')
  if (!owner || !repo) return null
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { sha?: string }
  return data.sha ?? null
}
