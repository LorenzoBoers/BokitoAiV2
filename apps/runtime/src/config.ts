import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function loadEnvFile(): void {
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '../../../.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq)
    const value = trimmed.slice(eq + 1)
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value
    }
  }
}

loadEnvFile()

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

export const config = {
  port: Number(process.env.WORKER_PORT || 3300),
  bindHost: process.env.WORKER_BIND_HOST || '127.0.0.1',
  xanoBaseUrl: process.env.XANO_BASE_URL?.replace(/\/+$/, '') || '',
  xanoWorkerApiKey: process.env.XANO_WORKER_API_KEY || '',
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  workerInboundSecret: process.env.WORKER_INBOUND_SECRET || '',
  dockerImageTag: process.env.DOCKER_IMAGE_TAG || 'bokito-agent-run:latest',
  dockerImageTagPlaywright:
    process.env.DOCKER_IMAGE_TAG_PLAYWRIGHT || process.env.DOCKER_IMAGE_TAG || 'bokito-agent-run-playwright:latest',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text-v2-moe',
  maxParallelPerTenant: Number(process.env.MAX_PARALLEL_PER_TENANT || 3),
  bullBoardBasicAuth: process.env.BULL_BOARD_BASIC_AUTH || '',
}

export function assertRuntimeConfig(): void {
  required('REDIS_URL')
  required('WORKER_INBOUND_SECRET')
}
