import { Info, type LucideIcon } from 'lucide-react'
import * as Icons from 'lucide-react'
import { cn } from '../../lib/utils'
import type { DocBlockRow, InlineRun } from '../../lib/doc-api'
import { buildBlockTree, type BlockNode } from '../../lib/doc-blocks'

interface BlockListProps {
  blocks: DocBlockRow[]
}

function resolveIcon(name: string | null | undefined): LucideIcon {
  if (!name) return Info
  const candidate = (Icons as unknown as Record<string, LucideIcon>)[name]
  return candidate || Info
}

function InlineRunsView({ runs }: { runs: InlineRun[] | null | undefined }) {
  if (!runs || runs.length === 0) return null
  return (
    <>
      {runs.map((run, i) => {
        let className = ''
        if (run.bold) className += ' font-semibold'
        if (run.italic) className += ' italic'
        if (run.underline) className += ' underline'
        if (run.strike) className += ' line-through'
        if (run.code) className += ' rounded bg-bg-surface px-1 py-0.5 font-mono text-xs'
        const style = run.color ? { color: run.color } : undefined
        const content = (
          <span key={i} className={className.trim()} style={style}>
            {run.text}
          </span>
        )
        if (run.link) {
          return (
            <a
              key={i}
              href={run.link}
              target="_blank"
              rel="noreferrer noopener"
              className={cn('text-accent underline', className.trim())}
              style={style}
            >
              {run.text}
            </a>
          )
        }
        return content
      })}
    </>
  )
}

function ActorBadge({ block }: { block: DocBlockRow }) {
  if (block.last_edited_by_type !== 'agent') return null
  return (
    <span className="absolute -left-3 top-1.5 h-2 w-2 rounded-full bg-accent" title="Last edit by agent" />
  )
}

function BlockNodeView({ node, depth }: { node: BlockNode; depth: number }) {
  const { block, children } = node

  const wrapperBase = 'group relative my-1 leading-relaxed text-text-primary'
  const wrapper = (inner: React.ReactNode) => (
    <div className={wrapperBase} style={depth ? { marginLeft: `${depth * 16}px` } : undefined}>
      <ActorBadge block={block} />
      {inner}
      {children.length > 0 ? (
        <div className="mt-1">
          {children.map((child) => (
            <BlockNodeView key={child.block.id} node={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )

  switch (block.type) {
    case 'heading_1':
      return wrapper(
        <h1 className="text-3xl font-semibold tracking-tight">
          <InlineRunsView runs={block.text} />
        </h1>,
      )
    case 'heading_2':
      return wrapper(
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">
          <InlineRunsView runs={block.text} />
        </h2>,
      )
    case 'heading_3':
      return wrapper(
        <h3 className="mt-4 text-lg font-semibold tracking-tight">
          <InlineRunsView runs={block.text} />
        </h3>,
      )
    case 'paragraph':
      return wrapper(
        <p className="text-base">
          <InlineRunsView runs={block.text} />
        </p>,
      )
    case 'bullet_list_item':
      return wrapper(
        <div className="flex items-baseline gap-2 text-base">
          <span aria-hidden className="text-text-muted">•</span>
          <span className="flex-1">
            <InlineRunsView runs={block.text} />
          </span>
        </div>,
      )
    case 'numbered_list_item':
      return wrapper(
        <div className="flex items-baseline gap-2 text-base">
          <span aria-hidden className="text-text-muted">{block.position + 1}.</span>
          <span className="flex-1">
            <InlineRunsView runs={block.text} />
          </span>
        </div>,
      )
    case 'to_do': {
      const checked = (block.props as { checked?: boolean } | undefined)?.checked === true
      return wrapper(
        <label className="flex items-baseline gap-2 text-base">
          <input
            type="checkbox"
            checked={checked}
            disabled
            className="mt-1 h-4 w-4 rounded border-border/60"
            readOnly
          />
          <span className={cn('flex-1', checked && 'text-text-muted line-through')}>
            <InlineRunsView runs={block.text} />
          </span>
        </label>,
      )
    }
    case 'quote':
      return wrapper(
        <blockquote className="border-l-4 border-border/60 pl-4 text-base italic text-text-secondary">
          <InlineRunsView runs={block.text} />
        </blockquote>,
      )
    case 'callout': {
      const props = block.props as { tone?: string; icon?: string } | undefined
      const tone = props?.tone ?? 'info'
      const Icon = resolveIcon(props?.icon)
      const toneClasses =
        tone === 'warning'
          ? 'border-status-warning/40 bg-status-warning/8'
          : tone === 'danger'
          ? 'border-status-error/40 bg-status-error/8'
          : 'border-accent/30 bg-accent/8'
      return wrapper(
        <div className={cn('flex gap-3 rounded-lg border px-4 py-3 text-base', toneClasses)}>
          <Icon className="mt-0.5 h-4 w-4 text-text-muted" />
          <div className="flex-1">
            <InlineRunsView runs={block.text} />
          </div>
        </div>,
      )
    }
    case 'divider':
      return wrapper(<hr className="my-6 border-border/60" />)
    case 'code': {
      const props = block.props as { language?: string } | undefined
      return wrapper(
        <pre className="overflow-x-auto rounded-lg border border-border/60 bg-bg-surface p-4 font-mono text-xs">
          {props?.language ? (
            <span className="block text-[10px] uppercase tracking-wide text-text-muted">
              {props.language}
            </span>
          ) : null}
          <code>
            {(block.text ?? []).map((r) => r.text).join('')}
          </code>
        </pre>,
      )
    }
    case 'image': {
      const props = block.props as { url?: string; alt?: string } | undefined
      if (!props?.url) return wrapper(<span className="text-text-muted text-sm">[image]</span>)
      return wrapper(
        <img src={props.url} alt={props.alt ?? ''} className="max-w-full rounded-lg border border-border/60" />,
      )
    }
    case 'embed': {
      const props = block.props as { url?: string } | undefined
      if (!props?.url) return wrapper(<span className="text-text-muted text-sm">[embed]</span>)
      return wrapper(
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer noopener"
          className="block rounded-lg border border-border/60 bg-bg-surface px-4 py-3 text-sm text-accent hover:bg-bg-hover"
        >
          {props.url}
        </a>,
      )
    }
    case 'link_to_page': {
      const props = block.props as { page_id?: string; label?: string } | undefined
      return wrapper(
        <span className="text-base text-accent">{props?.label ?? '[Linked page]'}</span>,
      )
    }
    case 'toggle':
      return wrapper(
        <details className="rounded-md border border-border/60 bg-bg-surface px-3 py-2">
          <summary className="cursor-pointer text-base">
            <InlineRunsView runs={block.text} />
          </summary>
        </details>,
      )
    case 'table': {
      const props = block.props as { rows?: string[][] } | undefined
      const rows = props?.rows ?? []
      return wrapper(
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-border/60 px-2 py-1">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      )
    }
    default:
      return wrapper(
        <p className="text-base text-text-muted">
          <InlineRunsView runs={block.text} />
        </p>,
      )
  }
}

export function BlockList({ blocks }: BlockListProps) {
  const tree = buildBlockTree(blocks)
  if (!tree.length) {
    return <p className="text-sm text-text-muted">This page has no blocks yet.</p>
  }
  return (
    <div className="space-y-1">
      {tree.map((node) => (
        <BlockNodeView key={node.block.id} node={node} depth={0} />
      ))}
    </div>
  )
}
