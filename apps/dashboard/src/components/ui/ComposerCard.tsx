import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type TextareaHTMLAttributes,
} from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  clampComposerFloor,
  COMPOSER_GROW,
  readComposerFloor,
  writeComposerFloor,
  type ComposerGrowMode,
} from '../../lib/composer-grow'
import { assistantLauncherRect } from '../../lib/personal-assistant-widget'
import { cn } from '../../lib/utils'
import { Tip } from './Tip'

type Props = {
  mode: ComposerGrowMode
  /** Outline: Ask is purple, Note is gray, Reply keeps the accent focus ring. */
  tone?: 'default' | 'ai' | 'note'
  value: string
  className?: string
  textareaClassName?: string
  overlay?: React.ReactNode
  /** Sits inside the border, above the text. Used for pasted images. */
  header?: React.ReactNode
  /**
   * Optional styled mirror of `value` rendered behind the textarea (mention
   * pills etc.). Must produce the exact same text layout as the textarea:
   * the textarea text turns transparent and this layer provides the visuals.
   */
  highlighter?: React.ReactNode
  /** Left side of the action row (attach). Children stay on the right. */
  leading?: React.ReactNode
  children?: React.ReactNode
  /** Increment to play the 2s AI-draft arrival glow. */
  aiFlashNonce?: number
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'children' | 'className' | 'rows' | 'style'>

function assignRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else ref.current = node
    }
  }
}

/**
 * Measure wrap height without collapsing the live field. Setting the focused
 * textarea to 0px grows the thread timeline for a frame; the browser then
 * clamps scrollTop and the list jumps up on the first keystroke.
 */
function measureTextareaContentHeight(el: HTMLTextAreaElement): number {
  const parent = el.parentElement
  if (!parent) return el.scrollHeight
  const cs = window.getComputedStyle(el)
  const clone = document.createElement('textarea')
  clone.value = el.value
  clone.rows = 1
  clone.tabIndex = -1
  clone.setAttribute('aria-hidden', 'true')
  clone.style.cssText = [
    'position:absolute',
    'visibility:hidden',
    'pointer-events:none',
    'height:0',
    'min-height:0',
    'max-height:none',
    'overflow:hidden',
    `width:${el.clientWidth}px`,
    `box-sizing:${cs.boxSizing}`,
    `padding:${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
    `border-width:${cs.borderTopWidth} ${cs.borderRightWidth} ${cs.borderBottomWidth} ${cs.borderLeftWidth}`,
    `border-style:${cs.borderStyle}`,
    `font:${cs.font}`,
    `letter-spacing:${cs.letterSpacing}`,
    `line-height:${cs.lineHeight}`,
    `white-space:${cs.whiteSpace}`,
    `word-break:${cs.wordBreak}`,
    `overflow-wrap:${cs.overflowWrap}`,
  ].join(';')
  parent.appendChild(clone)
  const height = clone.scrollHeight
  clone.remove()
  return height
}

export const ComposerCard = forwardRef<HTMLTextAreaElement, Props>(function ComposerCard(
  { mode, tone = 'default', value, className, textareaClassName, overlay, header, highlighter, leading, children, aiFlashNonce, ...textareaProps },
  forwardedRef,
) {
  const { t } = useTranslation('communication')
  const innerRef = useRef<HTMLTextAreaElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const highlightRef = useRef<HTMLDivElement>(null)
  const syncHighlightScroll = useCallback(() => {
    const el = innerRef.current
    const mirror = highlightRef.current
    if (el && mirror) mirror.scrollTop = el.scrollTop
  }, [])
  const floorRef = useRef(COMPOSER_GROW[mode].min)
  const preset = COMPOSER_GROW[mode]
  const [floor, setFloor] = useState(() => readComposerFloor(mode) ?? preset.min)
  floorRef.current = floor

  useLayoutEffect(() => {
    setFloor(readComposerFloor(mode) ?? COMPOSER_GROW[mode].min)
  }, [mode])

  const applyHeight = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    const floorPx = clampComposerFloor(mode, floor)
    const live = el.scrollHeight
    const content =
      live > el.offsetHeight + 1 ? live : measureTextareaContentHeight(el)
    const next = Math.min(preset.max, Math.max(preset.min, floorPx, content))
    if (el.offsetHeight !== next) el.style.height = `${next}px`
    el.style.overflowY = content > preset.max ? 'auto' : 'hidden'
  }, [floor, mode, preset.max, preset.min, value])

  useLayoutEffect(() => {
    applyHeight()
    syncHighlightScroll()
  }, [applyHeight, syncHighlightScroll])

  useLayoutEffect(() => {
    if (!aiFlashNonce) return
    const el = cardRef.current
    if (!el) return
    el.classList.remove('composer-ai-flash')
    void el.offsetWidth
    el.classList.add('composer-ai-flash')
  }, [aiFlashNonce])

  const commitFloor = (next: number) => {
    const clamped = clampComposerFloor(mode, next)
    setFloor(clamped)
    writeComposerFloor(mode, clamped === preset.min ? null : clamped)
  }

  const reset = () => commitFloor(preset.min)

  const toggleExpand = () => {
    commitFloor(floor >= preset.max - 8 ? preset.min : preset.max)
  }

  const dragStart = useRef({ y: 0, floor: preset.min })
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStart.current = { y: event.clientY, floor }
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('select-none')
    document.body.style.cursor = 'row-resize'
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = dragStart.current.y - event.clientY
    setFloor(clampComposerFloor(mode, dragStart.current.floor + delta))
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    document.body.classList.remove('select-none')
    document.body.style.cursor = ''
    commitFloor(floorRef.current)
  }

  // The floating helper launcher sits bottom-right and can be dragged; when it
  // lands on the action row, shift the actions left so Send stays clickable.
  const [launcherGutter, setLauncherGutter] = useState(0)
  useEffect(() => {
    const check = () => {
      const card = cardRef.current
      const launcher = assistantLauncherRect()
      let next = 0
      if (card && launcher) {
        const box = card.getBoundingClientRect()
        const overlaps =
          launcher.left < box.right &&
          launcher.right > box.right - 160 &&
          launcher.top < box.bottom &&
          launcher.bottom > box.bottom - 48
        if (overlaps) next = Math.min(120, Math.ceil(box.right - launcher.left) + 4)
      }
      setLauncherGutter((prev) => (prev === next ? prev : next))
    }
    check()
    const timer = window.setInterval(check, 1500)
    window.addEventListener('resize', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', check)
    }
  }, [])

  const expanded = floor >= preset.max - 8

  return (
    <div
      ref={cardRef}
      className={cn(
        'group/composer relative rounded-[22px] border border-transparent bg-bg-surface px-4 pb-2.5 pt-3.5 shadow-composer transition-[border-color,box-shadow] duration-200',
        tone === 'ai' &&
          'border-ai/55 focus-within:border-ai/80 focus-within:shadow-[0_0_0_3px_rgb(var(--color-ai)/0.22)]',
        tone === 'note' &&
          'border-border-light focus-within:border-border-light focus-within:shadow-[0_0_0_3px_rgb(var(--color-border)/0.32)]',
        className,
      )}
    >
      {overlay}
      <div className="absolute inset-x-0 top-0 z-10 flex h-3 items-center justify-center">
        <Tip label={t('composer.resizeHint')}>
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('composer.resize')}
            aria-valuemin={preset.min}
            aria-valuemax={preset.max}
            aria-valuenow={Math.round(floor)}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={reset}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                commitFloor(floor + 24)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                commitFloor(floor - 24)
              } else if (event.key === 'Enter' || event.key === 'Home') {
                event.preventDefault()
                reset()
              } else if (event.key === 'End') {
                event.preventDefault()
                commitFloor(preset.max)
              }
            }}
            className="flex h-3 w-full cursor-row-resize touch-none items-center justify-center"
          >
            <span
              className={cn(
                'h-0.5 w-6 rounded-full bg-border/40 transition-colors group-hover/composer:bg-border/80',
                tone === 'ai' && 'group-focus-within/composer:bg-ai/80 hover:bg-ai',
                tone === 'note' && 'group-focus-within/composer:bg-border hover:bg-border',
                tone === 'default' && 'group-focus-within/composer:bg-accent/70 hover:bg-accent',
              )}
            />
          </div>
        </Tip>
        {mode === 'email' ? null : (
          <Tip label={expanded ? t('composer.collapse') : t('composer.expand')}>
            <button
              type="button"
              onClick={toggleExpand}
              aria-label={expanded ? t('composer.collapse') : t('composer.expand')}
              className="absolute right-2 top-1 rounded-md p-1 text-text-muted/50 opacity-0 transition-all group-hover/composer:opacity-100 group-focus-within/composer:opacity-100 hover:bg-bg-hover hover:text-text-primary"
            >
              {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
            </button>
          </Tip>
        )}
      </div>
      {header ? <div className="mb-2">{header}</div> : null}
      <div className="flex flex-col gap-2">
        <div className="relative min-w-0 w-full flex-1">
          {highlighter ? (
            <div
              ref={highlightRef}
              aria-hidden
              className="composer-ai-flash-text pointer-events-none absolute inset-0 min-w-0 overflow-hidden whitespace-pre-wrap break-words text-lg leading-6 text-text-primary"
            >
              {highlighter}
            </div>
          ) : null}
          <textarea
            {...textareaProps}
            ref={assignRefs(innerRef, forwardedRef)}
            value={value}
            rows={1}
            onScroll={(event) => {
              syncHighlightScroll()
              textareaProps.onScroll?.(event)
            }}
            className={cn(
              'relative block min-h-0 min-w-0 w-full resize-none bg-transparent text-lg leading-6 placeholder:truncate placeholder:text-text-muted focus:outline-none disabled:opacity-50',
              highlighter ? 'text-transparent caret-[rgb(var(--color-text-primary))]' : 'text-text-primary',
              textareaClassName,
            )}
          />
        </div>
        {leading || children ? (
          <div
            className="flex w-full items-center gap-1"
            style={launcherGutter ? { paddingRight: launcherGutter } : undefined}
          >
            {leading ? <div className="flex min-w-0 items-center gap-0.5">{leading}</div> : null}
            {children ? (
              <div className="ml-auto flex shrink-0 items-center gap-0.5">{children}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
})
