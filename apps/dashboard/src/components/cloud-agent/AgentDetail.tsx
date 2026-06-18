import { useState } from 'react'
import {
  Copy,
  Check,
  Globe,
  Cpu,
  Gauge,
  Wrench,
  Terminal,
  ExternalLink,
} from 'lucide-react'
import type { CloudAgent } from '../../types'

const statusLabel: Record<CloudAgent['status'], string> = {
  active: 'Actief',
  paused: 'Gepauzeerd',
  deploying: 'Deployment bezig',
  error: 'Fout',
}

const statusClass: Record<CloudAgent['status'], string> = {
  active: 'badge-accent',
  paused: 'bg-bg-elevated text-text-muted text-2xs font-semibold px-2 py-0.5 rounded-full',
  deploying: 'bg-status-warning/15 text-status-warning text-2xs font-semibold px-2 py-0.5 rounded-full',
  error: 'bg-status-error/15 text-status-error text-2xs font-semibold px-2 py-0.5 rounded-full',
}

export default function AgentDetail({
  agent,
  variant = 'default',
}: {
  agent: CloudAgent
  variant?: 'default' | 'modal'
}) {
  const [copied, setCopied] = useState(false)
  const inModal = variant === 'modal'

  const snippet = `<script
  src="${agent.embedUrl}"
  data-bokito-chat-widget
  data-agent-slug="${agent.slug}"
  data-api-url=""
  defer
></script>`

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={
        inModal
          ? 'flex flex-col min-w-0 bg-bg'
          : 'flex-1 flex flex-col min-w-0 overflow-hidden bg-bg'
      }
    >
      <div className="px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-text-heading tracking-tight">
              {agent.name}
            </h2>
            <p className="text-sm text-text-muted mt-1 max-w-2xl">
              {agent.description}
            </p>
          </div>
          <span className={statusClass[agent.status]}>{statusLabel[agent.status]}</span>
        </div>
      </div>

      <div
        className={`px-6 py-5 space-y-6 ${
          inModal ? '' : 'flex-1 overflow-y-auto min-h-0'
        }`}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric
            icon={Cpu}
            label="Model"
            value={agent.model}
            mono
          />
          <Metric
            icon={Globe}
            label="Regio"
            value={agent.region}
          />
          <Metric
            icon={Gauge}
            label="Requests (24u)"
            value={String(agent.requests24h)}
          />
          <Metric
            icon={Gauge}
            label="Latency p50"
            value={agent.latencyP50}
          />
        </div>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">
            Embed — zelfde site als dashboard
          </h3>
          <div className="rounded-lg border border-border bg-bg-surface overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-elevated/50">
              <span className="text-2xs font-mono text-text-muted">
                index.html snippet
              </span>
              <button
                type="button"
                onClick={copySnippet}
                className="flex items-center gap-1.5 text-2xs font-medium text-accent hover:text-accent-hover transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={12} /> Gekopieerd
                  </>
                ) : (
                  <>
                    <Copy size={12} /> Kopiëren
                  </>
                )}
              </button>
            </div>
            <pre className="p-3 text-2xs font-mono text-text-secondary leading-relaxed overflow-x-auto">
              {snippet}
            </pre>
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2 flex items-center gap-2">
            <Wrench size={12} />
            Tools
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {agent.tools.map((t) => (
              <code
                key={t}
                className="text-2xs px-2 py-1 rounded-md bg-bg-elevated border border-border text-text-primary font-mono"
              >
                {t}
              </code>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2 flex items-center gap-2">
            <Terminal size={12} />
            System prompt (preview)
          </h3>
          <p className="text-sm text-text-secondary leading-relaxed border border-border rounded-lg p-3 bg-bg-surface font-mono text-2xs">
            {agent.systemPromptPreview}
          </p>
        </section>

        <div className="flex items-center gap-3 text-2xs text-text-muted pb-4">
          <span>Laatste deploy: {agent.lastDeployed}</span>
          <span className="text-border">|</span>
          <a
            href={agent.embedUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
          >
            Script-endpoint
            <ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ElementType
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="panel p-3">
      <div className="flex items-center gap-1.5 text-text-muted mb-1">
        <Icon size={12} />
        <span className="text-2xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div
        className={`text-xs font-semibold text-text-heading truncate ${
          mono ? 'font-mono text-2xs' : ''
        }`}
        title={value}
      >
        {value}
      </div>
    </div>
  )
}
