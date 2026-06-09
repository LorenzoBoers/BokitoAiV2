import { useState } from 'react';
import { X, Download, FileText, Database } from 'lucide-react';
import { useDatabase } from '../../context/DatabaseContext';
import type { ExportConfig, CustomField } from '../../types/custom-db';

interface DataExportProps {
  onClose: () => void;
}

export default function DataExport({ onClose }: DataExportProps) {
  const { activeTable, fields, records, activeView } = useDatabase();
  const [config, setConfig] = useState<ExportConfig>({
    format: 'csv',
    includeHeaders: true,
    fields: undefined, // null means all fields
    filters: activeView?.config && 'filters' in activeView.config ? activeView.config.filters : undefined,
  });
  const [isExporting, setIsExporting] = useState(false);

  const handleFieldToggle = (fieldSlug: string) => {
    const currentFields = config.fields || fields.map(f => f.slug);
    const newFields = currentFields.includes(fieldSlug)
      ? currentFields.filter(slug => slug !== fieldSlug)
      : [...currentFields, fieldSlug];
    
    setConfig(prev => ({
      ...prev,
      fields: newFields.length === fields.length ? undefined : newFields,
    }));
  };

  const handleSelectAll = () => {
    setConfig(prev => ({
      ...prev,
      fields: undefined, // null means all fields
    }));
  };

  const handleSelectNone = () => {
    setConfig(prev => ({
      ...prev,
      fields: [],
    }));
  };

  const getFilteredRecords = () => {
    if (!config.filters || config.filters.length === 0) {
      return records;
    }

    return records.filter(record => {
      return config.filters!.every(filter => {
        const value = record.data[filter.fieldSlug];
        
        switch (filter.operator) {
          case 'eq':
            return value === filter.value;
          case 'neq':
            return value !== filter.value;
          case 'contains':
            return String(value || '').toLowerCase().includes(String(filter.value || '').toLowerCase());
          case 'gt':
            return Number(value) > Number(filter.value);
          case 'lt':
            return Number(value) < Number(filter.value);
          case 'gte':
            return Number(value) >= Number(filter.value);
          case 'lte':
            return Number(value) <= Number(filter.value);
          case 'empty':
            return !value || value === '';
          case 'not_empty':
            return value && value !== '';
          default:
            return true;
        }
      });
    });
  };

  const exportToCSV = (_data: typeof records, selectedFields: CustomField[]) => {
    const filteredRecords = getFilteredRecords();
    const rows: string[] = [];

    // Add headers if enabled
    if (config.includeHeaders) {
      const headers = selectedFields.map(field => `"${field.name}"`);
      rows.push(headers.join(','));
    }

    // Add data rows
    filteredRecords.forEach(record => {
      const row = selectedFields.map(field => {
        const value = record.data[field.slug];
        const stringValue = formatValueForExport(value, field);
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      });
      rows.push(row.join(','));
    });

    return rows.join('\n');
  };

  const exportToJSON = (_data: typeof records, selectedFields: CustomField[]) => {
    const filteredRecords = getFilteredRecords();
    
    const exportData = filteredRecords.map(record => {
      const exportRecord: Record<string, unknown> = {};
      
      selectedFields.forEach(field => {
        const value = record.data[field.slug];
        exportRecord[field.name] = formatValueForExport(value, field, 'json');
      });
      
      return exportRecord;
    });

    return JSON.stringify(exportData, null, 2);
  };

  const formatValueForExport = (value: unknown, field: CustomField, format: 'csv' | 'json' = 'csv'): string => {
    if (value === null || value === undefined) {
      return format === 'json' ? '' : '';
    }

    switch (field.field_type) {
      case 'date':
        if (value instanceof Date) {
          return value.toISOString().split('T')[0];
        }
        if (typeof value === 'string') {
          const date = new Date(value);
          return isNaN(date.getTime()) ? String(value) : date.toISOString().split('T')[0];
        }
        return String(value);
      
      case 'boolean':
        return value ? 'true' : 'false';
      
      case 'multi_select':
        if (Array.isArray(value)) {
          return value.join(', ');
        }
        return String(value);
      
      default:
        return String(value);
    }
  };

  const handleExport = async () => {
    if (!activeTable) return;

    setIsExporting(true);
    
    try {
      const selectedFields = config.fields 
        ? fields.filter(f => config.fields!.includes(f.slug))
        : fields;

      let content: string;
      let filename: string;
      let mimeType: string;

      if (config.format === 'csv') {
        content = exportToCSV(records, selectedFields);
        filename = `${activeTable.slug}-export.csv`;
        mimeType = 'text/csv;charset=utf-8;';
      } else {
        content = exportToJSON(records, selectedFields);
        filename = `${activeTable.slug}-export.json`;
        mimeType = 'application/json;charset=utf-8;';
      }

      // Create and download file
      const blob = new Blob([content], { type: mimeType });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      onClose();
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const selectedFields = config.fields 
    ? fields.filter(f => config.fields!.includes(f.slug))
    : fields;
  
  const filteredRecordCount = getFilteredRecords().length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-text-heading">
            Data exporteren
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Format Selection */}
          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-3">
              Export formaat
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfig(prev => ({ ...prev, format: 'csv' }))}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  config.format === 'csv'
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-surface hover:border-border-focus'
                }`}
              >
                <div className="flex items-center gap-3">
                  <FileText className={`w-5 h-5 ${
                    config.format === 'csv' ? 'text-accent' : 'text-text-muted'
                  }`} />
                  <div>
                    <p className="font-medium text-text-primary">CSV</p>
                    <p className="text-sm text-text-secondary">
                      Komma-gescheiden bestand
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setConfig(prev => ({ ...prev, format: 'json' }))}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  config.format === 'json'
                    ? 'border-accent bg-accent/5'
                    : 'border-border bg-bg-surface hover:border-border-focus'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Database className={`w-5 h-5 ${
                    config.format === 'json' ? 'text-accent' : 'text-text-muted'
                  }`} />
                  <div>
                    <p className="font-medium text-text-primary">JSON</p>
                    <p className="text-sm text-text-secondary">
                      Gestructureerd data formaat
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Options */}
          <div>
            <h3 className="text-sm font-medium text-text-secondary mb-3">
              Opties
            </h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.includeHeaders}
                  onChange={(e) => setConfig(prev => ({ ...prev, includeHeaders: e.target.checked }))}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span className="text-sm text-text-secondary">
                  Kolomnamen opnemen {config.format === 'csv' ? '(eerste rij)' : ''}
                </span>
              </label>
            </div>
          </div>

          {/* Field Selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-text-secondary">
                Select fields
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  Alles
                </button>
                <span className="text-xs text-text-muted">•</span>
                <button
                  onClick={handleSelectNone}
                  className="text-xs text-accent hover:text-accent-hover transition-colors"
                >
                  Niets
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto space-y-2 border border-border rounded-lg p-3">
              {fields.map((field) => (
                <label key={field.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!config.fields || config.fields.includes(field.slug)}
                    onChange={() => handleFieldToggle(field.slug)}
                    className="rounded border-border text-accent focus:ring-accent"
                  />
                  <span className="text-sm text-text-primary">{field.name}</span>
                  <span className="text-xs text-text-muted">({field.field_type})</span>
                </label>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 bg-bg-muted rounded-lg border border-border">
            <h4 className="text-sm font-medium text-text-secondary mb-2">
              Export samenvatting
            </h4>
            <div className="space-y-1 text-sm">
              <p className="text-text-primary">
                <strong>{filteredRecordCount}</strong> rijen
              </p>
              <p className="text-text-primary">
                <strong>{selectedFields.length}</strong> velden
              </p>
              <p className="text-text-primary">
                Formaat: <strong>{config.format.toUpperCase()}</strong>
              </p>
              {activeView && config.filters && config.filters.length > 0 && (
                <p className="text-text-secondary">
                  Met filters van weergave "{activeView.name}"
                </p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
              Annuleren
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting || selectedFields.length === 0}
              className="flex items-center gap-2 px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}