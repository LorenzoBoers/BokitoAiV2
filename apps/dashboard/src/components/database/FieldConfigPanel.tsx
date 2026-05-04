import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { useDatabase } from '../../context/DatabaseContext'
import type { FieldConfig, FieldType, SelectOption, CustomTable, DefaultValue } from '../../types/custom-db'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select'
import { STANDARD_TABLES } from '../../data/standard-tables'

const OPTION_COLORS = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

const COLOR_RAMPS: Record<string, string[]> = {
  default:  ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b'],
  blue:     ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a'],
  green:    ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d'],
  red:      ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'],
  yellow:   ['#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12'],
  purple:   ['#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87'],
  pink:     ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843'],
  gray:     ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937'],
  indigo:   ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3'],
}

function DefaultValueEditor({ value, onChange, fieldType }: {
  value?: DefaultValue
  onChange: (dv?: DefaultValue) => void
  fieldType: FieldType
}) {
  if (fieldType === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
        <input
          type="checkbox"
          checked={value as boolean ?? false}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded"
        />
        Standaardwaarde
      </label>
    )
  }
  return (
    <div>
      <label className="text-xs text-text-secondary mb-1 block">Standaardwaarde (optioneel)</label>
      <Input
        value={value as string ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder="Geen standaardwaarde"
        className="text-xs"
      />
    </div>
  )
}

export default function FieldConfigPanel({
  fieldType,
  config,
  onChange,
  defaultValue,
  onDefaultValueChange,
}: {
  fieldType: FieldType
  config: FieldConfig
  onChange: (c: FieldConfig) => void
  defaultValue?: DefaultValue
  onDefaultValueChange?: (dv?: DefaultValue) => void
}) {
  if (fieldType === 'text') {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Max lengte (optioneel)</label>
          <Input
            type="number"
            value={config.maxLength ?? ''}
            onChange={(e) => onChange({ ...config, maxLength: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Onbeperkt"
          />
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Regex validatie (optioneel)</label>
          <Input
            value={config.regex ?? ''}
            onChange={(e) => onChange({ ...config, regex: e.target.value || undefined })}
            placeholder="Bijv. ^[A-Z]{2}[0-9]{4}$"
          />
          {config.regex && (
            <div className="mt-1">
              <Input
                value={config.regexMessage ?? ''}
                onChange={(e) => onChange({ ...config, regexMessage: e.target.value || undefined })}
                placeholder="Foutmelding bij ongeldige invoer"
                className="text-xs"
              />
            </div>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={config.unique ?? false}
            onChange={(e) => onChange({ ...config, unique: e.target.checked })}
            className="rounded"
          />
          Unieke waarden verplicht
        </label>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'long_text') {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Max lengte (optioneel)</label>
          <Input
            type="number"
            value={config.maxLength ?? ''}
            onChange={(e) => onChange({ ...config, maxLength: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="Onbeperkt"
          />
        </div>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'number') {
    return (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={config.isInteger ?? false}
            onChange={(e) => onChange({ ...config, isInteger: e.target.checked, decimals: e.target.checked ? 0 : config.decimals })}
            className="rounded"
          />
          Alleen gehele getallen
        </label>
        {!config.isInteger && (
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Decimalen</label>
            <Input
              type="number"
              value={config.decimals ?? 0}
              onChange={(e) => onChange({ ...config, decimals: Number(e.target.value) })}
              min={0}
              max={10}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Min</label>
            <Input
              type="number"
              value={config.min ?? ''}
              onChange={(e) => onChange({ ...config, min: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Max</label>
            <Input
              type="number"
              value={config.max ?? ''}
              onChange={(e) => onChange({ ...config, max: e.target.value ? Number(e.target.value) : undefined })}
            />
          </div>
        </div>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'date') {
    return (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={config.includeTime ?? false}
            onChange={(e) => onChange({ ...config, includeTime: e.target.checked })}
            className="rounded"
          />
          Inclusief tijd
        </label>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  // datetime, json, created_at, updated_at don't need configuration
  if (fieldType === 'datetime' || fieldType === 'json' || fieldType === 'created_at' || fieldType === 'updated_at') {
    return (
      <div className="text-xs text-text-muted">
        Dit veldtype heeft geen configuratie-opties.
      </div>
    )
  }

  if (fieldType === 'select' || fieldType === 'multi_select') {
    return (
      <div className="space-y-3">
        <SelectOptionsEditor config={config} onChange={onChange} />
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'attachment') {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Toegestane bestandstypen</label>
          <Select
            value={config.accept?.join(',') ?? 'all'}
            onValueChange={(value) => {
              const accept = value === 'all' ? undefined : value.split(',')
              onChange({ ...config, accept })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle bestandstypen</SelectItem>
              <SelectItem value="image/*">Alleen afbeeldingen</SelectItem>
              <SelectItem value="application/pdf">Alleen PDF</SelectItem>
              <SelectItem value="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv">Excel/CSV</SelectItem>
              <SelectItem value="application/vnd.openxmlformats-officedocument.wordprocessingml.document">Word documenten</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Max bestandsgrootte (MB)</label>
            <Input
              type="number"
              value={config.maxFileSize ?? 25}
              onChange={(e) => onChange({ ...config, maxFileSize: Number(e.target.value) })}
              min={1}
              max={100}
            />
          </div>
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Max aantal bestanden</label>
            <Input
              type="number"
              value={config.maxFiles ?? 10}
              onChange={(e) => onChange({ ...config, maxFiles: Number(e.target.value) })}
              min={1}
              max={50}
            />
          </div>
        </div>
      </div>
    )
  }

  if (fieldType === 'currency') {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Valutasymbool</label>
          <Select
            value={config.symbol ?? 'EUR'}
            onValueChange={(value) => onChange({ ...config, symbol: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Decimalen</label>
          <Input
            type="number"
            value={config.decimals ?? 2}
            onChange={(e) => onChange({ ...config, decimals: Number(e.target.value) })}
            min={0}
            max={4}
          />
        </div>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'rating') {
    return (
      <div className="space-y-3">
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Max sterren</label>
          <Input
            type="number"
            value={config.max ?? 5}
            onChange={(e) => onChange({ ...config, max: Number(e.target.value) })}
            min={1}
            max={10}
          />
        </div>
        {onDefaultValueChange && (
          <DefaultValueEditor value={defaultValue} onChange={onDefaultValueChange} fieldType={fieldType} />
        )}
      </div>
    )
  }

  if (fieldType === 'relation') {
    return <RelationConfigEditor config={config} onChange={onChange} />
  }

  return null
}

function SelectOptionsEditor({ config, onChange }: { config: FieldConfig; onChange: (c: FieldConfig) => void }) {
  const options = config.options ?? []
  const [draft, setDraft] = useState('')
  const colorRamp = config.colorRamp ?? 'default'
  const colors = COLOR_RAMPS[colorRamp as keyof typeof COLOR_RAMPS]

  const addOption = () => {
    if (!draft.trim()) return
    const newOpt: SelectOption = {
      value: draft.trim().toLowerCase().replace(/\s+/g, '_'),
      label: draft.trim(),
      color: colors[options.length % colors.length],
    }
    onChange({ ...config, options: [...options, newOpt] })
    setDraft('')
  }

  const removeOption = (idx: number) => {
    onChange({ ...config, options: options.filter((_, i) => i !== idx) })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-text-secondary mb-1 block">Kleurenschema</label>
        <Select
          value={colorRamp}
          onValueChange={(value) => {
            const newColors = COLOR_RAMPS[value as keyof typeof COLOR_RAMPS]
            const updatedOptions = options.map((opt, idx) => ({
              ...opt,
              color: newColors[idx % newColors.length]
            }))
            onChange({ ...config, colorRamp: value, options: updatedOptions })
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Standaard</SelectItem>
            <SelectItem value="blue">Blauw</SelectItem>
            <SelectItem value="green">Groen</SelectItem>
            <SelectItem value="red">Rood</SelectItem>
            <SelectItem value="yellow">Geel</SelectItem>
            <SelectItem value="purple">Paars</SelectItem>
            <SelectItem value="pink">Roze</SelectItem>
            <SelectItem value="gray">Grijs</SelectItem>
            <SelectItem value="indigo">Indigo</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <label className="text-xs text-text-secondary block">Opties</label>
        <div className="space-y-1 max-h-[180px] overflow-y-auto mt-1">
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2 group">
              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: opt.color }} />
              <span className="text-xs flex-1 truncate text-text-primary">{opt.label}</span>
              <button
                type="button"
                onClick={() => removeOption(idx)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-text-muted hover:text-status-error transition-opacity"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
            placeholder="Nieuwe optie..."
            className="text-xs"
          />
          <Button type="button" size="sm" variant="secondary" onClick={addOption} disabled={!draft.trim()}>
            <Plus size={12} />
          </Button>
        </div>
      </div>
    </div>
  )
}

function RelationConfigEditor({ config, onChange }: { config: FieldConfig; onChange: (c: FieldConfig) => void }) {
  const { tables } = useDatabase();
  const [availableTables, setAvailableTables] = useState<Array<{ id: number; name: string; slug: string; isStandard?: boolean }>>([]);

  useEffect(() => {
    // Combine actual tables with standard table definitions
    const standardTableOptions = STANDARD_TABLES.map(st => ({
      id: -1, // Placeholder ID for standard tables
      name: st.name,
      slug: st.slug,
      isStandard: true,
    }));

    const customTableOptions = tables
      .filter(t => !t.is_standard) // Only show custom tables that aren't standard
      .map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        isStandard: false,
      }));

    // Add existing standard tables from the database
    const existingStandardTables = tables
      .filter(t => t.is_standard)
      .map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        isStandard: true,
      }));

    setAvailableTables([...existingStandardTables, ...standardTableOptions.filter(st => 
      !existingStandardTables.some(est => est.slug === st.slug)
    ), ...customTableOptions]);
  }, [tables]);

  const selectedTable = availableTables.find(t => t.id === config.tableId);

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-text-secondary mb-1 block">Doeltabel</label>
        <select
          value={config.tableId || ''}
          onChange={(e) => {
            const tableId = e.target.value ? Number(e.target.value) : undefined;
            const table = availableTables.find(t => t.id === tableId);
            onChange({ 
              ...config, 
              tableId,
              displayField: table?.isStandard ? 'naam' : 'name' // Default display field
            });
          }}
          className="w-full p-2 text-xs border border-border rounded-md bg-bg-elevated focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Selecteer een tabel...</option>
          
          {/* Standard Tables */}
          {availableTables.filter(t => t.isStandard).length > 0 && (
            <>
              <optgroup label="CRM Tabellen">
                {availableTables.filter(t => t.isStandard).map(table => (
                  <option key={`standard-${table.slug}`} value={table.id}>
                    {table.name}
                  </option>
                ))}
              </optgroup>
            </>
          )}
          
          {/* Custom Tables */}
          {availableTables.filter(t => !t.isStandard).length > 0 && (
            <>
              <optgroup label="Aangepaste Tabellen">
                {availableTables.filter(t => !t.isStandard).map(table => (
                  <option key={`custom-${table.id}`} value={table.id}>
                    {table.name}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>
      </div>

      {selectedTable && (
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Weergaveveld</label>
          <Input
            value={config.displayField || (selectedTable.isStandard ? 'naam' : 'name')}
            onChange={(e) => onChange({ ...config, displayField: e.target.value })}
            placeholder={selectedTable.isStandard ? 'naam' : 'name'}
            className="text-xs"
          />
          <p className="text-xs text-text-muted mt-1">
            Welk veld wordt getoond als label voor de relatie
          </p>
        </div>
      )}
    </div>
  );
}
