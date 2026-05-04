import { } from 'react';
import { Table, Users, Briefcase, CheckSquare, Package, Plus } from 'lucide-react';
import type { OnboardingStep2Data } from '../../types/custom-db';

interface OnboardingStep2Props {
  data: OnboardingStep2Data;
  onChange: (data: OnboardingStep2Data) => void;
}

const TABLE_TEMPLATES = [
  {
    id: 'blank' as const,
    name: 'Lege tabel',
    description: 'Begin met een lege tabel en voeg je eigen velden toe',
    icon: Plus,
    fields: [],
  },
  {
    id: 'contacts' as const,
    name: 'Contacten',
    description: 'Beheer klanten, leveranciers en andere contacten',
    icon: Users,
    fields: ['Naam', 'E-mail', 'Telefoon', 'Bedrijf', 'Notities'],
  },
  {
    id: 'projects' as const,
    name: 'Projecten',
    description: 'Houd projecten en hun voortgang bij',
    icon: Briefcase,
    fields: ['Projectnaam', 'Status', 'Startdatum', 'Einddatum', 'Budget'],
  },
  {
    id: 'tasks' as const,
    name: 'Taken',
    description: 'Organiseer en beheer taken en to-do items',
    icon: CheckSquare,
    fields: ['Taak', 'Status', 'Prioriteit', 'Toegewezen aan', 'Deadline'],
  },
  {
    id: 'inventory' as const,
    name: 'Inventaris',
    description: 'Beheer producten, voorraad en materialen',
    icon: Package,
    fields: ['Product', 'SKU', 'Aantal', 'Locatie', 'Prijs'],
  },
];

export default function OnboardingStep2({ data, onChange }: OnboardingStep2Props) {
  const handleTemplateSelect = (template: typeof data.table_template) => {
    onChange({
      ...data,
      table_template: template,
      table_name: template === 'blank' ? '' : TABLE_TEMPLATES.find(t => t.id === template)?.name || '',
    });
  };

  const handleTableNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...data,
      table_name: e.target.value,
    });
  };

  const selectedTemplate = TABLE_TEMPLATES.find(t => t.id === data.table_template);

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Table className="w-8 h-8 text-accent" />
        </div>
        <h2 className="text-2xl font-semibold text-text-heading mb-2">
          Maak je eerste tabel
        </h2>
        <p className="text-text-secondary">
          Kies een sjabloon om snel te beginnen, of start met een lege tabel
        </p>
      </div>

      {/* Template Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TABLE_TEMPLATES.map((template) => {
          const Icon = template.icon;
          const isSelected = data.table_template === template.id;
          
          return (
            <button
              key={template.id}
              onClick={() => handleTemplateSelect(template.id)}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:border-accent/50 ${
                isSelected
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-bg-surface hover:bg-bg-muted/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-md ${
                  isSelected ? 'bg-accent text-white' : 'bg-bg-muted text-text-muted'
                }`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-text-primary mb-1">
                    {template.name}
                  </h3>
                  <p className="text-sm text-text-secondary mb-2">
                    {template.description}
                  </p>
                  {template.fields.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {template.fields.slice(0, 3).map((field, index) => (
                        <span
                          key={index}
                          className="text-xs px-2 py-1 bg-bg-muted text-text-muted rounded"
                        >
                          {field}
                        </span>
                      ))}
                      {template.fields.length > 3 && (
                        <span className="text-xs text-text-muted">
                          +{template.fields.length - 3} meer
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Table Name */}
      {data.table_template === 'blank' && (
        <div>
          <label htmlFor="table-name" className="block text-sm font-medium text-text-secondary mb-2">
            Tabelnaam *
          </label>
          <input
            id="table-name"
            type="text"
            value={data.table_name || ''}
            onChange={handleTableNameChange}
            placeholder="Bijv. Klanten, Producten, Taken..."
            className="w-full px-4 py-3 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus transition"
          />
        </div>
      )}

      {/* Preview */}
      {selectedTemplate && (data.table_template !== 'blank' || data.table_name) && (
        <div className="p-4 bg-bg-muted rounded-lg border border-border">
          <p className="text-sm text-text-secondary mb-2">Je eerste tabel:</p>
          <div className="flex items-center gap-3 mb-3">
            <selectedTemplate.icon className="w-5 h-5 text-accent" />
            <span className="font-medium text-text-primary">
              {data.table_name || selectedTemplate.name}
            </span>
          </div>
          {selectedTemplate.fields.length > 0 && (
            <div>
              <p className="text-xs text-text-muted mb-2">Velden die worden aangemaakt:</p>
              <div className="flex flex-wrap gap-2">
                {selectedTemplate.fields.map((field, index) => (
                  <span
                    key={index}
                    className="text-xs px-2 py-1 bg-bg-surface text-text-secondary rounded border"
                  >
                    {field}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}