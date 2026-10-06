import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEvent,
} from 'react'
import { cn } from '../../lib/utils'

type ScrollFadeProps = {
  children: ReactNode
  /** Classes for the scrolling element (the inner box). */
  className?: string
  /** Classes for the outer wrapper that hosts the fade overlays. */
  wrapperClassName?: string
  /**
   * CSS variable holding the RGB triplet behind the list, e.g. `--color-bg-surface`.
   * Defaults to `--color-bg` (rail / section navs).
   */
  fadeColorVar?: string
  /** Pixel threshold before a fade appears. */
  threshold?: number
  onScroll?: (event: UIEvent<HTMLDivElement>) => void
}

/**
 * Vertical scroll container whose top and bottom edges fade into the
 * surrounding background when there is more content in that direction.
 * Pair with the `.scroll-fade` recipe in index.css.
 */
const ScrollFade = forwardRef<HTMLDivElement, ScrollFadeProps>(function ScrollFade(
  {
    children,
    className,
    wrapperClassName,
    fadeColorVar = '--color-bg',
    threshold = 4,
    onScroll,
  },
  ref,
) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [fadeTop, setFadeTop] = useState(false)
  const [fadeBottom, setFadeBottom] = useState(false)

  const setInner = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node
      if (typeof ref === 'function') ref(node)
      else if (ref) ref.current = node
    },
    [ref],
  )

  const measure = useCallback(() => {
    const el = innerRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    setFadeTop(scrollTop > threshold)
    setFadeBottom(scrollHeight - clientHeight - scrollTop > threshold)
  }, [threshold])

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(measure) : null
    mo?.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener('scroll', measure)
      ro?.disconnect()
      mo?.disconnect()
    }
  }, [measure])

  const style = { '--scroll-fade-color': `rgb(var(${fadeColorVar}))` } as CSSProperties

  return (
    <div
      className={cn('scroll-fade flex min-h-0 flex-1 flex-col', wrapperClassName)}
      data-fade-top={fadeTop ? 'true' : 'false'}
      data-fade-bottom={fadeBottom ? 'true' : 'false'}
      style={style}
    >
      <div
        ref={setInner}
        className={cn('min-h-0 flex-1 overflow-y-auto', className)}
        onScroll={onScroll}
      >
        {children}
      </div>
    </div>
  )
})

export default ScrollFade
