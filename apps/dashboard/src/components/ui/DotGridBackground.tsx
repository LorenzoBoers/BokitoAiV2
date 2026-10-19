import { useEffect, useRef } from 'react'
import { useTheme } from '../../context/ThemeContext'

/**
 * Quiet dot lattice for an empty page. Dots near the pointer grow a little
 * and darken; the rest stay faint.
 */
export function DotGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { isDark } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    if (!canvas || !parent) return

    const pointer = { x: -9999, y: -9999 }
    let frame = 0

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = parent.clientWidth
      const height = parent.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const gap = 28
      const reach = 120
      const ink = isDark ? '255,255,255' : '88,84,78'
      const base = isDark ? 0.09 : 0.13
      for (let y = gap / 2; y < height; y += gap) {
        for (let x = gap / 2; x < width; x += gap) {
          const dist = Math.hypot(x - pointer.x, y - pointer.y)
          const near = dist < reach ? 1 - dist / reach : 0
          ctx.beginPath()
          ctx.fillStyle = `rgba(${ink},${base + near * 0.26})`
          ctx.arc(x, y, 0.95 + near * 0.9, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(draw)
    }

    const onMove = (event: PointerEvent) => {
      const rect = parent.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      schedule()
    }
    const onLeave = () => {
      pointer.x = -9999
      pointer.y = -9999
      schedule()
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(parent)
    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    schedule()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
    }
  }, [isDark])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
