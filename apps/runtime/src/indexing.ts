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
