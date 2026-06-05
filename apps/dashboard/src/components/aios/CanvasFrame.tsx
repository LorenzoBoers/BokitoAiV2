import type { ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type CanvasNodeLayout = {
  id: string
  x: number
  y: number
  width?: number
  height?: number
}

export type CanvasEdge = {
  id: string
  from: { x: number; y: number }
  to: { x: number; y: number }
}

type CanvasFrameProps = {
  width: number
  height: number
  edges?: CanvasEdge[]
  children: ReactNode
  className?: string
  hint?: string
  'data-testid'?: string
}

export default function CanvasFrame({
  width,
  height,
  edges = [],
  children,
  className,
  hint,
  'data-testid': testId,
}: CanvasFrameProps) {
  return (
    <div className={cn('aios-canvas-shell', className)} data-testid={testId}>
      {hint ? <p className="aios-canvas-hint">{hint}</p> : null}
      <div className="aios-canvas-stage">
        <div
          className="aios-canvas-map"
          style={{ width, height, minWidth: width, minHeight: height }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={height}
            aria-hidden
          >
            {edges.map((edge) => (
              <line
                key={edge.id}
                className="aios-canvas-edge"
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
              />
            ))}
          </svg>
          {children}
        </div>
      </div>
    </div>
  )
}

export function positionedNode(
  id: string,
  x: number,
  y: number,
  node: ReactNode,
  width = 200,
  height = 88,
) {
  return (
    <div
      key={id}
      className="absolute"
      style={{ left: x, top: y, width, height }}
    >
      {node}
    </div>
  )
}
