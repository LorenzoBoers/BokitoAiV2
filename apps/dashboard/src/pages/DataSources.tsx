import { Badge } from '../components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

export default function DataSources() {
  return (
    <div className="h-full py-4 flex flex-col gap-3">
      <Card className="flex-1 min-h-0 flex flex-col">
        <CardHeader>
          <div>
            <CardTitle>Databronnen</CardTitle>
            <p className="text-xs text-text-secondary mt-0.5">
              Koppel externe bronnen om data automatisch te synchroniseren.
            </p>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border/60 bg-surface-secondary/40 p-4 flex flex-col items-center gap-3">
              <img src="/logo-outlook.png" alt="Outlook" className="h-10 w-10 object-contain" />
              <div className="text-center">
                <p className="text-xs font-medium text-text-heading">Outlook</p>
                <p className="text-2xs text-text-muted mt-0.5">E-mail en agenda synchronisatie via Microsoft Outlook.</p>
              </div>
              <Badge variant="neutral" className="mt-auto">Binnenkort</Badge>
            </div>

            <div className="rounded-lg border border-border/60 bg-surface-secondary/40 p-4 flex flex-col items-center gap-3">
              <img src="/logo-king.png" alt="King Software" className="h-10 w-10 object-contain" />
              <div className="text-center">
                <p className="text-xs font-medium text-text-heading">King Software</p>
                <p className="text-2xs text-text-muted mt-0.5">Boekhouding, facturatie en bedrijfsadministratie.</p>
              </div>
              <Badge variant="neutral" className="mt-auto">Binnenkort</Badge>
            </div>

            <div className="rounded-lg border border-border/60 bg-surface-secondary/40 p-4 flex flex-col items-center gap-3">
              <img src="/logo-excel.png" alt="Excel" className="h-10 w-10 object-contain" />
              <div className="text-center">
                <p className="text-xs font-medium text-text-heading">Excel</p>
                <p className="text-2xs text-text-muted mt-0.5">Importeer en synchroniseer data uit Excel-bestanden.</p>
              </div>
              <Badge variant="neutral" className="mt-auto">Binnenkort</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
