import type { ReactNode } from 'react'

type ContentHeaderProps = {
  title: string
  subtitle?: ReactNode
  /** Right-aligned controls (buttons, pills, filters). */
  meta?: ReactNode
}

/** OpenClaw-style page header: title + subtitle left, controls right. */
export default function ContentHeader({ title, subtitle, meta }: ContentHeaderProps) {
  return (
    <section className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-text-heading">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p> : null}
      </div>
      {meta ? <div className="flex items-center gap-2">{meta}</div> : null}
    </section>
  )
}
