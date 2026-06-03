import { PageContent } from '../components/layout/PageContent'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'

const columns = [
  { id: 'idea', title: 'Idea' },
  { id: 'planned', title: 'Planned' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'done', title: 'Done' },
]

export default function AgendaPage() {
  return (
    <PageContent width="xl" className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text-heading">Agenda</h1>
        <p className="text-sm text-text-muted mt-1">Roadmap board and scheduled orchestra tasks</p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {columns.map((col) => (
          <Card key={col.id}>
            <CardHeader>
              <CardTitle className="text-base">{col.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-text-muted">Items from orchestra tasks appear here.</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageContent>
  )
}
