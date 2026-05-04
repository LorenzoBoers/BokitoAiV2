import { useState, useCallback } from 'react';
import { Download, X, FileText, Database, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import { useDatabase } from '../../context/DatabaseContext';
import { exportData } from '../../lib/custom-db-api';
import type { ExportOptions } from '../../types/custom-db';
import { toast } from 'sonner';

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ExportDialog({ isOpen, onClose }: ExportDialogProps) {
  const { activeTable, fields, records, activeView } = useDatabase();
  const [options, setOptions] = useState<ExportOptions>({
    format: 'csv',
    includeHeaders: true,
    applyFilters: true,
    applySort: true,
  });
  const [isExporting, setIsExporting] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());

  const handleFieldToggle = useCallback((fieldSlug: string) => {
    setSelectedFields(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fieldSlug)) {
        newSet.delete(fieldSlug);
      } else {
        newSet.add(fieldSlug);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedFields.size === fields.length) {
      setSelectedFields(new Set());
    } else {
      setSelectedFields(new Set(fields.map(f => f.slug)));
    }
  }, [fields, selectedFields.size]);

  const handleExport = useCallback(async () => {
    if (!activeTable) return;

    const exportOptions: ExportOptions = {
      ...options,
      ...(selectedFields.size > 0 && { selectedFields: Array.from(selectedFields) }),
    };

    setIsExporting(true);
    try {
      const result = await exportData(activeTable.id, exportOptions);
      
      // Download the file
      const link = document.createElement('a');
      link.href = result.downloadUrl;
      link.download = `${activeTable.name}.${options.format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast.success('Export succesvol gedownload');
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onbekende fout';
      toast.error(`Export mislukt: ${message}`);
    } finally {
      setIsExporting(false);
    }
  }, [activeTable, options, selectedFields, onClose]);

  if (!isOpen || !activeTable) return null;

  const recordCount = records.length;
  const fieldCount = selectedFields.size > 0 ? selectedFields.size : fields.length;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Data Exporteren</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Export format */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-3">
              Exportformaat
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setOptions(prev => ({ ...prev, format: 'csv' }))}
                className={cn(
                  'flex items-center gap-3 p-4 rounded-lg border transition-colors',
                  options.format === 'csv'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border hover:border-border-focus'
                )}
              >
                <FileText size={20} />
                <div className="text-left">
                  <p className="font-medium">CSV</p>
                  <p className="text-xs text-text-muted">Komma-gescheiden waarden</p>
                </div>
              </button>
              
              <button
                type="button"
                onClick={() => setOptions(prev => ({ ...prev, format: 'json' }))}
                className={cn(
                  'flex items-center gap-3 p-4 rounded-lg border transition-colors',
                  options.format === 'json'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border hover:border-border-focus'
                )}
              >
                <Database size={20} />
                <div className="text-left">
                  <p className="font-medium">JSON</p>
                  <p className="text-xs text-text-muted">Gestructureerde data</p>
                </div>
              </button>
            </div>
          </div>

          {/* Export options */}
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-3">
              Export opties
            </label>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={options.includeHeaders}
                  onChange={(e) => setOptions(prev => ({ ...prev, includeHeaders: e.target.checked }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Kolomnamen meenemen</span>
              </label>
              
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={options.applyFilters}
                  onChange={(e) => setOptions(prev => ({ ...prev, applyFilters: e.target.checked }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Huidige filters toepassen</span>
              </label>
              
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={options.applySort}
                  onChange={(e) => setOptions(prev => ({ ...prev, applySort: e.target.checked }))}
                  className="rounded border-border"
                />
                <span className="text-sm">Huidige sortering toepassen</span>
              </label>
            </div>
          </div>

          {/* Field selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-text-secondary">
                Velden selecteren
              </label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-accent hover:text-accent-hover"
              >
                {selectedFields.size === fields.length ? 'Deselecteer alles' : 'Selecteer alles'}
              </button>
            </div>
            
            <div className="max-h-40 overflow-y-auto border border-border rounded-lg">
              {fields.map((field) => (
                <label
                  key={field.id}
                  className="flex items-center gap-3 p-3 hover:bg-bg-hover cursor-pointer border-b border-border last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedFields.size === 0 || selectedFields.has(field.slug)}
                    onChange={() => handleFieldToggle(field.slug)}
                    className="rounded border-border"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{field.name}</p>
                    <p className="text-xs text-text-muted">{field.field_type}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Export summary */}
          <div className="p-4 bg-bg-surface rounded-lg">
            <h4 className="font-medium mb-2">Export samenvatting</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-text-muted">Records:</span>
                <span className="ml-2 font-medium">{recordCount.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-text-muted">Velden:</span>
                <span className="ml-2 font-medium">{fieldCount}</span>
              </div>
              <div>
                <span className="text-text-muted">Formaat:</span>
                <span className="ml-2 font-medium uppercase">{options.format}</span>
              </div>
              <div>
                <span className="text-text-muted">View:</span>
                <span className="ml-2 font-medium">{activeView?.name || 'Standaard'}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={onClose}>
              Annuleren
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Loader2 size={16} className="mr-2 animate-spin" />
                  Exporteren...
                </>
              ) : (
                <>
                  <Download size={16} className="mr-2" />
                  Exporteren
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}