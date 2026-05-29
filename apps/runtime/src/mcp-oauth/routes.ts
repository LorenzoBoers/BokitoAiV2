import type { Express, Request, Response } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import {
  buildMcpOAuthStart,
  exchangeMcpOAuthCode,
  providerInputFromRow,
  refreshMcpOAuthToken,
} from './engine.js'
import type { OAuthProfile, ProviderOAuthInput } from './types.js'

function inboundAuthFailed(req: Request): boolean {
  const header = req.headers.authorization || ''
  const expected = `Bearer ${config.workerInboundSecret}`
  if (!header || !config.workerInboundSecret || header.length !== expected.length) return true
  try {
    return !timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  } catch {
    return true
  }
}

function parseProviderBody(body: Record<string, unknown>): ProviderOAuthInput {
  return providerInputFromRow({
    slug: String(body.slug ?? ''),
    mcp_remote_url: body.mcp_remote_url as string | null,
    mcp_transport: body.mcp_transport as string | null,
    oauth_config_key: body.oauth_config_key as string | null,
    oauth_profile: body.oauth_profile as OAuthProfile | null,
  })
}

export function registerMcpOAuthRoutes(app: Express): void {
  app.post('/internal/mcp/oauth/start', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    try {
      const provider = parseProviderBody((req.body?.provider ?? req.body) as Record<string, unknown>)
      const stateId = req.body?.state_id as string | undefined
      const result = await buildMcpOAuthStart(provider, { state_id: stateId })
      res.json(result)
    } catch (e) {
      res.status(400).json({ error: (e as Error).message })
    }
  })

  app.post('/internal/mcp/oauth/exchange', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const code = String(req.body?.code ?? '')
    const codeVerifier = String(req.body?.code_verifier ?? '')
    if (!code || !codeVerifier) {
      res.status(400).json({ error: 'code and code_verifier required' })
      return
    }
    try {
      const provider = parseProviderBody((req.body?.provider ?? req.body) as Record<string, unknown>)
      const tokens = await exchangeMcpOAuthCode({
        provider,
        code,
        code_verifier: codeVerifier,
        oauth_client_id: req.body?.oauth_client_id as string | undefined,
      })
      res.json(tokens)
    } catch (e) {
      res.status(400).json({ error: (e as Error).message })
    }
  })

  app.post('/internal/mcp/oauth/refresh', async (req: Request, res: Response) => {
    if (inboundAuthFailed(req)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const refreshToken = String(req.body?.refresh_token ?? '')
    if (!refreshToken) {
      res.status(400).json({ error: 'refresh_token required' })
      return
    }
    try {
      const provider = parseProviderBody((req.body?.provider ?? req.body) as Record<string, unknown>)
      const tokens = await refreshMcpOAuthToken({ provider, refresh_token: refreshToken })
      res.json(tokens)
    } catch (e) {
      res.status(400).json({ error: (e as Error).message })
    }
  })
}
