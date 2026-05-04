import { BarChart3 } from 'lucide-react'

export default function Analytics() {
  return (
    <div className="h-full min-h-0 flex flex-col items-center justify-center py-8 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <BarChart3 size={28} className="text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-text-heading">Analytics</h2>
      <p className="text-sm text-text-secondary mt-2 max-w-sm">
        Deze pagina is nog in ontwikkeling. Hier komen straks overzichten, gebruik &amp; kosten en auditlogs.
      </p>
    </div>
  )
}
