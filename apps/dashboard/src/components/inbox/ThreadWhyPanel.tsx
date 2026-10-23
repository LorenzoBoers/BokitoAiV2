/**
 * "Why" popover in the thread header. The server builds every line (kind,
 * params, href); this component only translates and links them.
 */
import { useState } from 'react'
import { Button } from '../ui/button'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { appRoutes } from '../../api/routes'
import { useAuth } from '../../context/AuthContext'
import { apiGet } from '../../lib/api'

type WhyLine = { kind: string; params: Record<string, string | number>; href: string | null }

export function ThreadWhyPanel({ threadId }: { threadId: string }) {
  const { token } = useAuth()
  const { t } = useTranslation('communication')
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<WhyLine[] | null>(null)
  const [failed, setFailed] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || lines || !token) return
    try {
      const row = await apiGet<{ lines: WhyLine[] }>(appRoutes.signals.threadWhy(threadId), token)
      setLines(row.lines)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  const render = (line: WhyLine) => {
    const params = { ...line.params }
    if (params.mode) params.mode = t(`threadWhy.modes.${params.mode}`)
    if (params.channel) {
      params.channel = t(`composer.channel.${params.channel}`, { defaultValue: String(params.channel) })
    }
    if (line.kind === 'delivered_works_in' && !params.item) {
      params.item = t(`nav:projects.worksIn.kind.${params.item_kind}`, { defaultValue: '' })
    }
    return t(`threadWhy.lines.${line.kind}`, params)
  }

  const external = (href: string) => /^https?:\/\//.test(href)

  return (
    <div className="relative">
      <Button variant="ghost" size="xs"
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        data-testid="thread-why-toggle"
      >
        {t('threadWhy.button')}
      </Button>
      {open ? (
        <div
          className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-border bg-bg p-3 text-xs text-text shadow-sm"
          data-testid="thread-why-panel"
        >
          <p className="mb-2 font-medium">{t('threadWhy.title')}</p>
          {failed ? <p className="text-text-muted">{t('threadWhy.failed')}</p> : null}
          {!failed && !lines ? <p className="text-text-muted">{t('threadWhy.loading')}</p> : null}
          {lines ? (
            <ul className="space-y-1.5">
              {lines.map((line, index) => (
                <li key={`${line.kind}-${index}`} className="leading-snug">
                  {line.href && external(line.href) ? (
                    <a href={line.href} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
                      {render(line)}
                    </a>
                  ) : line.href ? (
                    <Link to={line.href} className="hover:text-accent hover:underline" onClick={() => setOpen(false)}>
                      {render(line)}
                    </Link>
                  ) : (
                    render(line)
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
