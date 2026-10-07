import * as React from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '../../lib/utils'

const TEXT_LINK_CLASS =
  'inline-flex items-center gap-1 font-medium text-accent underline-offset-2 transition-colors hover:underline focus-visible:outline-none focus-visible:underline disabled:pointer-events-none disabled:opacity-50'

const TONE = {
  accent: 'text-accent',
  muted: 'text-text-muted hover:text-text-heading',
} as const

type Tone = keyof typeof TONE

type TextLinkProps =
  | ({ to: LinkProps['to']; tone?: Tone } & Omit<LinkProps, 'to'>)
  | ({ href: string; tone?: Tone } & React.AnchorHTMLAttributes<HTMLAnchorElement>)
  | ({ to?: undefined; href?: undefined; tone?: Tone } & React.ButtonHTMLAttributes<HTMLButtonElement>)

/** Inline text action: router link, external link, or button. */
export function TextLink(props: TextLinkProps) {
  const { tone = 'accent', className, ...rest } = props
  const cls = cn(TEXT_LINK_CLASS, TONE[tone], className)
  if ('to' in rest && rest.to !== undefined) {
    return <Link {...(rest as LinkProps)} className={cls} />
  }
  if ('href' in rest && rest.href !== undefined) {
    const anchor = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>
    const external = /^https?:\/\//.test(anchor.href ?? '')
    return (
      <a
        target={external ? '_blank' : undefined}
        rel={external ? 'noreferrer' : undefined}
        {...anchor}
        className={cls}
      />
    )
  }
  const button = rest as React.ButtonHTMLAttributes<HTMLButtonElement>
  return <button type="button" {...button} className={cls} />
}

export default TextLink
