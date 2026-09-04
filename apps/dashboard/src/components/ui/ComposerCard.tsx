import {
  forwardRef,
  useCallback,
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
import { cn } from '../../lib/utils'

type Props = {
  mode: ComposerGrowMode
  value: string
  className?: string
  textareaClassName?: string
  overlay?: React.ReactNode
  /**
   * Optional styled mirror of `value` rendered behind the textarea (mention
   * pills etc.). Must produce the exact same text layout as the textarea:
   * the textarea text turns transparent and this layer provides the visuals.
   */
  highlighter?: React.ReactNode
  children?: React.ReactNode
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

export const ComposerCard = forwardRef<HTMLTextAreaElement, Props>(function ComposerCard(
  { mode, value, className, textareaClassName, overlay, highlighter, children, ...textareaProps },
  forwardedRef,
) {
  const { t } = useTranslation('communication')
  const innerRef = useRef<HTMLTextAreaElement>(null)
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
    el.style.height = '0px'
    const content = el.scrollHeight
    const next = Math.min(preset.max, Math.max(preset.min, floorPx, content))
    el.style.height = `${next}px`
    el.style.overflowY = content > preset.max ? 'auto' : 'hidden'
  }, [floor, mode, preset.max, preset.min, value])

  useLayoutEffect(() => {
    applyHeight()
    syncHighlightScroll()
  }, [applyHeight, syncHighlightScroll])

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

  const expanded = floor >= preset.max - 8

  return (
    <div
      className={cn(
        'group/composer relative rounded-2xl border bg-bg-elevated/40 px-3 pb-2 pt-3 shadow-card transition-[border-color,box-shadow] duration-200',
        'focus-within:border-accent/55 focus-within:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.16)]',
        className,
      )}
    >
      {overlay}
      <div className="absolute inset-x-0 top-0 z-10 flex h-3 items-center justify-center">
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('composer.resize')}
          aria-valuemin={preset.min}
          aria-valuemax={preset.max}
          aria-valuenow={Math.round(floor)}
          title={t('composer.resizeHint')}
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
          <span className="h-0.5 w-6 rounded-full bg-border/40 transition-colors group-hover/composer:bg-border/80 group-focus-within/composer:bg-accent/70 hover:bg-accent" />
        </div>
        <button
          type="button"
          onClick={toggleExpand}
          title={expanded ? t('composer.collapse') : t('composer.expand')}
          aria-label={expanded ? t('composer.collapse') : t('composer.expand')}
          className="absolute right-2 top-1 rounded-md p-1 text-text-muted/50 opacity-0 transition-all group-hover/composer:opacity-100 group-focus-within/composer:opacity-100 hover:bg-bg-hover hover:text-text-primary"
        >
          {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
        </button>
      </div>
      <div className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          {highlighter ? (
            // Mirror layer: same metrics as the textarea, draws pills/colors
            // while the textarea itself only shows the caret and selection.
            <div
              ref={highlightRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-[13.5px] leading-[22px] text-text-primary"
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
              'relative block min-h-0 w-full resize-none bg-transparent text-[13.5px] leading-[22px] placeholder:text-text-muted focus:outline-none disabled:opacity-50',
              highlighter ? 'text-transparent caret-text-primary' : 'text-text-primary',
              textareaClassName,
            )}
          />
        </div>
        {children}
      </div>
    </div>
  )
})
