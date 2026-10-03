import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { NavLink, type NavLinkProps } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Tip } from '../ui/Tip'

type NavRowBaseProps = {
  icon?: LucideIcon
  label: ReactNode
  /** Trailing count. Rendered muted; set `unread` to colour it. */
  count?: number
  unread?: boolean
  /** Trailing slot (badge, chevron, action). Overrides `count`. */
  trailing?: ReactNode
  /** Icon-only rendering (collapsed rail). Label becomes the tooltip. */
  iconOnly?: boolean
  /** Visual nesting inside a folder. */
  depth?: 0 | 1
  active?: boolean
  className?: string
}

function formatCount(n: number) {
  return n > 99 ? '99+' : String(n)
}

function RowInner({ icon: Icon, label, count, unread, trailing, iconOnly }: NavRowBaseProps) {
  return (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      {iconOnly ? null : <span className="min-w-0 flex-1 truncate-fade">{label}</span>}
      {iconOnly ? (
        unread && count ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" /> : null
      ) : trailing !== undefined ? (
        <span className="ml-auto flex shrink-0 items-center">{trailing}</span>
      ) : count ? (
        <span className="nav-count" data-unread={unread ? 'true' : 'false'}>
          {formatCount(count)}
        </span>
      ) : null}
    </>
  )
}

function rowClass({ iconOnly, depth, active, className }: NavRowBaseProps) {
  return cn(
    'nav-row relative',
    iconOnly && 'h-8 w-8 justify-center px-0',
    depth === 1 && !iconOnly && 'pl-6',
    className,
  )
}

function tipLabel(title: string | undefined, iconOnly: boolean | undefined, label: ReactNode) {
  if (title) return title
  if (iconOnly && typeof label === 'string') return label
  return undefined
}

type NavRowLinkProps = NavRowBaseProps & Omit<NavLinkProps, 'className' | 'children'>

/** Router-aware nav row. Uses `aria-current="page"` from NavLink for the active state. */
export const NavRowLink = forwardRef<HTMLAnchorElement, NavRowLinkProps>(function NavRowLink(
  { icon, label, count, unread, trailing, iconOnly, depth, active, className, title, ...linkProps },
  ref,
) {
  const base = { icon, label, count, unread, trailing, iconOnly, depth, active, className }
  const tip = tipLabel(typeof title === 'string' ? title : undefined, iconOnly, label)
  const link = (
    <NavLink
      ref={ref}
      {...linkProps}
      aria-label={iconOnly && typeof label === 'string' ? label : undefined}
      className={rowClass(base)}
      data-active={active ? 'true' : undefined}
    >
      <RowInner {...base} />
    </NavLink>
  )
  return tip ? (
    <Tip label={tip} side="right">
      {link}
    </Tip>
  ) : (
    link
  )
})

type NavRowButtonProps = NavRowBaseProps & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'>

/** Button-shaped nav row for actions (new chat, open menu, toggle). */
export const NavRowButton = forwardRef<HTMLButtonElement, NavRowButtonProps>(function NavRowButton(
  { icon, label, count, unread, trailing, iconOnly, depth, active, className, title, type = 'button', ...buttonProps },
  ref,
) {
  const base = { icon, label, count, unread, trailing, iconOnly, depth, active, className }
  const tip = tipLabel(title, iconOnly, label)
  const button = (
    <button
      ref={ref}
      type={type}
      {...buttonProps}
      aria-label={iconOnly && typeof label === 'string' ? label : undefined}
      className={rowClass(base)}
      data-active={active ? 'true' : undefined}
    >
      <RowInner {...base} />
    </button>
  )
  return tip ? (
    <Tip label={tip} side="right">
      {button}
    </Tip>
  ) : (
    button
  )
})
