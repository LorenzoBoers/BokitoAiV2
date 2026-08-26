import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { cn } from '../../lib/utils'
import {
  applyDrag,
  fitWidths,
  readSplitWidths,
  resolveWidths,
  writeSplitWidths,
  type SplitPaneSpec,
  type SplitWidths,
} from '../../lib/split-panes'

export type SplitPaneProps = SplitPaneSpec & {
  children?: ReactNode
  className?: string
  /** Accessible name for the separator that resizes this pane. */
  label?: string
  /** Extra classes on the separator (e.g. `hidden lg:block`). */
  handleClassName?: string
}

export function SplitPane(_props: SplitPaneProps) {
  return null
}

function isSplitPane(child: ReactNode): child is ReactElement<SplitPaneProps> {
  return isValidElement(child) && child.type === SplitPane
}

type HandleProps = {
  label: string
  hint?: string
  min: number
  max: number
  value: number
  onDrag: (delta: number) => void
  onCommit: () => void
  onReset: () => void
  invert?: boolean
  className?: string
}

function SplitHandle({
  label,
  hint,
  min,
  max,
  value,
  onDrag,
  onCommit,
  onReset,
  invert = false,
  className,
}: HandleProps) {
  const lastX = useRef(0)
  const dragging = useRef(false)
  const [active, setActive] = useState(false)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragging.current = true
    setActive(true)
    lastX.current = event.clientX
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('select-none')
    document.body.style.cursor = 'col-resize'
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const delta = event.clientX - lastX.current
    lastX.current = event.clientX
    onDrag(invert ? -delta : delta)
  }

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    setActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('select-none')
    document.body.style.cursor = ''
    onCommit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      onDrag(invert ? step : -step)
      onCommit()
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      onDrag(invert ? -step : step)
      onCommit()
    } else if (event.key === 'Home') {
      event.preventDefault()
      onDrag(invert ? max - value : min - value)
      onCommit()
    } else if (event.key === 'End') {
      event.preventDefault()
      onDrag(invert ? min - value : max - value)
      onCommit()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onReset()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title={hint || label}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className={cn('group relative z-20 hidden w-0 shrink-0 md:block', className)}
    >
      {active ? <div className="fixed inset-0 z-[80] cursor-col-resize" /> : null}
      <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize touch-none" />
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 transition-[width,background-color,box-shadow]',
          'group-hover:w-0.5 group-hover:bg-accent group-focus-visible:w-0.5 group-focus-visible:bg-accent',
          'group-active:w-0.5 group-active:bg-accent group-active:shadow-[0_0_0_1px_rgb(var(--color-accent)/0.25)]',
        )}
      />
    </div>
  )
}

type SplitRowProps = {
  storageKey: string
  minFlex?: number
  className?: string
  resetHint?: string
  children: ReactNode
}

export function SplitRow({ storageKey, minFlex = 320, className, resetHint, children }: SplitRowProps) {
  const panes = useMemo(
    () => Children.toArray(children).filter(isSplitPane),
    [children],
  )
  const specs = useMemo(
    () =>
      panes.map((pane) => ({
        id: pane.props.id,
        defaultWidth: pane.props.defaultWidth,
        minWidth: pane.props.minWidth,
        maxWidth: pane.props.maxWidth,
        flex: pane.props.flex,
      })),
    [panes],
  )
  const specKey = specs.map((spec) => spec.id).join('|')

  const [widths, setWidths] = useState<SplitWidths>(() =>
    resolveWidths(specs, readSplitWidths(storageKey)),
  )
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setWidths(resolveWidths(specs, readSplitWidths(storageKey)))
  }, [storageKey, specKey])

  const reflow = useCallback(
    (next: SplitWidths) => {
      const container = rowRef.current?.clientWidth ?? 0
      return fitWidths(specs, next, container, minFlex)
    },
    [minFlex, specs],
  )

  useEffect(() => {
    const node = rowRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setWidths((current) => reflow(current))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [reflow])

  const persist = useCallback(
    (next: SplitWidths) => {
      writeSplitWidths(storageKey, next)
    },
    [storageKey],
  )

  const dragPane = useCallback(
    (id: string, delta: number) => {
      setWidths((current) => {
        const spec = specs.find((item) => item.id === id)
        if (!spec) return current
        const container = rowRef.current?.clientWidth ?? 0
        return applyDrag(specs, current, id, (current[id] ?? spec.defaultWidth) + delta, container, minFlex)
      })
    },
    [minFlex, specs],
  )

  const resetPane = useCallback(
    (id: string) => {
      const spec = specs.find((item) => item.id === id)
      if (!spec) return
      setWidths((current) => {
        const next = reflow({ ...current, [id]: spec.defaultWidth })
        persist(next)
        return next
      })
    },
    [persist, reflow, specs],
  )

  const commit = useCallback(() => {
    setWidths((current) => {
      persist(current)
      return current
    })
  }, [persist])

  return (
    <div ref={rowRef} className={cn('flex min-h-0 min-w-0 flex-1 overflow-hidden', className)}>
      {panes.map((pane, index) => {
        const spec = specs[index]
        const next = specs[index + 1]
        const width = widths[spec.id] ?? spec.defaultWidth
        const handleAfter = next && !spec.flex
        const handleBeforeNext = next && spec.flex && !next.flex
        return (
          <div key={spec.id} className="contents">
            <div
              className={cn(
                'flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
                spec.flex ? 'flex-1' : 'w-full shrink-0 md:!w-[var(--split-w)]',
                pane.props.className,
              )}
              style={!spec.flex ? ({ '--split-w': `${width}px` } as CSSProperties) : undefined}
            >
              {pane.props.children}
            </div>
            {handleAfter ? (
              <SplitHandle
                label={pane.props.label || spec.id}
                hint={resetHint}
                min={spec.minWidth}
                max={spec.maxWidth}
                value={width}
                className={pane.props.handleClassName}
                onDrag={(delta) => dragPane(spec.id, delta)}
                onCommit={commit}
                onReset={() => resetPane(spec.id)}
              />
            ) : null}
            {handleBeforeNext ? (
              <SplitHandle
                label={panes[index + 1]?.props.label || next.id}
                hint={resetHint}
                min={next.minWidth}
                max={next.maxWidth}
                value={widths[next.id] ?? next.defaultWidth}
                invert
                className={panes[index + 1]?.props.handleClassName}
                onDrag={(delta) => dragPane(next.id, delta)}
                onCommit={commit}
                onReset={() => resetPane(next.id)}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
