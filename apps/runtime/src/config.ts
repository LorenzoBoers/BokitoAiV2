function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

export const config = {
  port: Number(process.env.WORKER_PORT || 3300),
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
}

export function assertRuntimeConfig(): void {
  required('REDIS_URL')
  required('WORKER_INBOUND_SECRET')
}
