/**
 * Short edge washes over the Grid and Workflow canvas only.
 * z-10 sits above the stage (z-0) and under page chrome (z-20): tabs, lenses,
 * filters, zoom and the glass panels. Uses `--color-bg`, so light and dark.
 */
export function OrgEdgeFades() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-bg via-bg/70 to-transparent" />
      <div className="absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-bg via-bg/40 to-transparent" />
      <div className="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-bg via-bg/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg via-bg/60 to-transparent" />
    </div>
  )
}
