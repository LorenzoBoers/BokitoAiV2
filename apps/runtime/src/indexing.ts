import { config } from './config.js'

/**
 * Phase 4: embed text via Ollama nomic-embed-text-v2-moe (768d).
 */
export async function embedDocumentText(text: string, prefix: 'search_document' | 'search_query'): Promise<number[]> {
  const prompt = `${prefix}: ${text}`
  const res = await fetch(`${config.ollamaBaseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.ollamaEmbeddingModel, prompt }),
  })
  if (!res.ok) throw new Error(`Ollama embeddings failed: ${res.status}`)
  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding?.length) throw new Error('Empty embedding')
  return data.embedding
}

export async function searchIndex(projectId: string, query: string, topK = 8): Promise<unknown[]> {
  const embedding = await embedDocumentText(query, 'search_query')
  const res = await fetch(`${config.xanoBaseUrl}/api:workforce/index/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.xanoWorkerApiKey}`,
    },
    body: JSON.stringify({ project_id: projectId, embedding, top_k: topK }),
  })
  if (!res.ok) return []
  const data = (await res.json()) as { results?: unknown[] }
  return data.results ?? []
}

export interface IndexJobData {
  project_id?: string
  workspace_doc_id?: string
  tenant_id: string
  file_path: string
  content: string
  source_type?: string
}

const CHUNK_MAX_CHARS = 2400

function chunkText(text: string, maxChars = CHUNK_MAX_CHARS): string[] {
  if (!text.trim()) return ['']
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += maxChars) {
    chunks.push(text.slice(start, start + maxChars))
  }
  return chunks
}

async function upsertIndexChunk(input: {
  project_id?: string
  workspace_doc_id?: string
  tenant_id: string
  source_type: string
  source_ref: string
  content: string
  embedding: number[]
}): Promise<void> {
  const res = await fetch(`${config.xanoBaseUrl}/api:workforce/index/chunks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.xanoWorkerApiKey}`,
    },
    body: JSON.stringify({
      worker_api_key: config.xanoWorkerApiKey,
      ...input,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`index chunk upsert failed: ${res.status} ${body.slice(0, 200)}`)
  }
}

export async function processIndexJob(data: IndexJobData): Promise<{ chunks: number }> {
  const sourceType = data.source_type || 'repo_file'
  const parts = chunkText(data.content)
  let written = 0

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const embedding = await embedDocumentText(part, 'search_document')
    const sourceRef =
      parts.length === 1 ? data.file_path : `${data.file_path}:chunk-${i + 1}`
    await upsertIndexChunk({
      project_id: data.project_id,
      workspace_doc_id: data.workspace_doc_id,
      tenant_id: data.tenant_id,
      source_type: sourceType,
      source_ref: sourceRef,
      content: part,
      embedding,
    })
    written++
  }

  return { chunks: written }
}
