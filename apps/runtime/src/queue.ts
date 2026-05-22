import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from './config.js'
import { processIndexJob, type IndexJobData } from './indexing.js'
import { processAgentJob, type AgentJobData } from './runner.js'

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null })

export const agentQueue = new Queue<AgentJobData>('bokito-agent', { connection })

export function startAgentWorker(): Worker<AgentJobData> {
  return new Worker<AgentJobData>(
    'bokito-agent',
    async (job) => {
      await processAgentJob(job.data)
    },
    {
      connection,
      concurrency: config.maxParallelPerTenant,
    }
  )
}

export const indexQueue = new Queue<IndexJobData>('bokito-index', { connection })

export function startIndexWorker(): Worker<IndexJobData> {
  return new Worker<IndexJobData>(
    'bokito-index',
    async (job) => {
      const result = await processIndexJob(job.data)
      console.log('[index]', job.id, job.data.file_path, `${result.chunks} chunks`)
    },
    { connection, concurrency: 2 }
  )
}
