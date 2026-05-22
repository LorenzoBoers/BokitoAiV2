import { Queue, Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from './config.js'
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

export const indexQueue = new Queue('bokito-index', { connection })

export function startIndexWorker(): Worker {
  return new Worker(
    'bokito-index',
    async (job) => {
      console.log('[index]', job.id, job.data)
    },
    { connection, concurrency: 2 }
  )
}
