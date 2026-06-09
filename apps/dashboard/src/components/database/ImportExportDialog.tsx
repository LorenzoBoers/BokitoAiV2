import React, { useState, useRef, useCallback } from 'react';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { 
  Upload, 
  Download, 
  FileText, 
  Check, 
  AlertCircle, 
  X,
  ChevronDown,
  ChevronRight
} from 'lucide-react';
import { useDatabase } from '../../context/DatabaseContext';
import type { ImportProgress, CustomField } from '../../types/custom-db';
import { cn } from '../../lib/utils';

interface ImportExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'import' | 'export';
}

interface CSVPreview {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

interface FieldMapping {
  csvColumn: string;
  fieldId: number | null;
  fieldName: string;
  isRequired: boolean;
}

function ImportExportDialog({ isOpen, onClose, mode }: ImportExportDialogProps) {
  const { activeTable, fields, records, addRecord } = useDatabase();
  const [step, setStep] = useState<'upload' | 'mapping' | 'progress' | 'complete'>('upload');
  const [csvPreview, setCsvPreview] = useState<CSVPreview | null>(null);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    total: 0,
    processed: 0,
    errors: [],
    isComplete: false,
  });
  const [isDragOver, setIsDragOver] = useState(false);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [showErrors, setShowErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) {
      alert('Alleen CSV bestanden zijn toegestaan');
      return;
    }

    const text = await file.text();
    const preview = parseCSV(text);
    setCsvPreview(preview);
    
    // Auto-map fields based on header names
    const mappings = preview.headers.map(header => {
      const matchingField = fields.find(f => 
        f.name.toLowerCase() === header.toLowerCase() ||
        f.slug.toLowerCase() === header.toLowerCase()
      );
      
      return {
        csvColumn: header,
        fieldId: matchingField?.id || null,
        fieldName: matchingField?.name || '',
        isRequired: matchingField?.required || false,
      };
    });
    
    setFieldMappings(mappings);
    setStep('mapping');
  }, [fields]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  }, [handleFileUpload]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const startImport = async () => {
    if (!csvPreview || !activeTable) return;

    setStep('progress');
    const total = csvPreview.rows.length;
    setImportProgress({ total, processed: 0, errors: [], isComplete: false });

    // Simulate import process
    for (let i = 0; i < csvPreview.rows.length; i++) {
      const row = csvPreview.rows[i];
      
      try {
        // Map CSV row to record data
        const recordData: Record<string, any> = {};
        fieldMappings.forEach(mapping => {
          if (mapping.fieldId) {
            const csvIndex = csvPreview.headers.indexOf(mapping.csvColumn);
            if (csvIndex !== -1) {
              recordData[mapping.fieldName] = row[csvIndex] || '';
            }
          }
        });

        // Validate required fields
        const missingRequired = fieldMappings
          .filter(m => m.isRequired && m.fieldId && !recordData[m.fieldName])
          .map(m => m.fieldName);

        if (missingRequired.length > 0) {
          throw new Error(`Verplichte velden ontbreken: ${missingRequired.join(', ')}`);
        }

        await addRecord(recordData);
        
        setImportProgress(prev => ({
          ...prev,
          processed: i + 1,
        }));

        // Add delay to show progress
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Onbekende fout';
        setImportProgress(prev => ({
          ...prev,
          processed: i + 1,
          errors: [...prev.errors, `Rij ${i + 2}: ${message}`],
        }));
      }
    }

    setImportProgress(prev => ({ ...prev, isComplete: true }));
    setStep('complete');
  };

  const exportData = () => {
    if (!activeTable || !records.length) return;

    const data = records.map(record => record.data);
    
    if (exportFormat === 'csv') {
      exportAsCSV(data);
    } else {
      exportAsJSON(data);
    }
    
    onClose();
  };

  const exportAsCSV = (data: Record<string, any>[]) => {
    if (!activeTable) return;
    
    const headers = fields.map(f => f.name);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          const value = row[header] || '';
          return typeof value === 'string' && value.includes(',') 
            ? `"${value.replace(/"/g, '""')}"` 
            : value;
        }).join(',')
      )
    ].join('\n');

    downloadFile(csvContent, `${activeTable.name}.csv`, 'text/csv');
  };

  const exportAsJSON = (data: Record<string, any>[]) => {
    if (!activeTable) return;
    
    const jsonContent = JSON.stringify(data, null, 2);
    downloadFile(jsonContent, `${activeTable.name}.json`, 'application/json');
  };

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-surface border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-heading">
            {mode === 'import' ? 'Gegevens importeren' : 'Gegevens exporteren'}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
          {mode === 'import' ? (
            <>
              {/* Import: Upload Step */}
              {step === 'upload' && (
                <div className="space-y-4">
                  <div
                    className={cn(
                      'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                      isDragOver
                        ? 'border-accent bg-accent/5'
                        : 'border-border hover:border-border-light'
                    )}
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={() => setIsDragOver(true)}
                    onDragLeave={() => setIsDragOver(false)}
                  >
                    <Upload className="w-12 h-12 text-text-muted mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">
                      Sleep je CSV bestand hierheen
                    </h3>
                    <p className="text-text-secondary mb-4">
                      Of klik om een bestand te selecteren
                    </p>
                    <Button onClick={() => fileInputRef.current?.click()}>
                      Bestand selecteren
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </div>
                </div>
              )}

              {/* Import: Mapping Step */}
              {step === 'mapping' && csvPreview && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-text-primary">
                      Map fields
                    </h3>
                    <Badge variant="secondary">
                      {csvPreview.rows.length} rijen
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {fieldMappings.map((mapping, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-bg-elevated rounded-md">
                        <div className="flex-1">
                          <div className="font-medium text-text-primary">
                            {mapping.csvColumn}
                          </div>
                          <div className="text-sm text-text-secondary">
                            CSV kolom
                          </div>
                        </div>
                        
                        <ChevronRight className="text-text-muted" size={16} />
                        
                        <div className="flex-1">
                          <select
                            value={mapping.fieldId || ''}
                            onChange={(e) => {
                              const fieldId = e.target.value ? parseInt(e.target.value) : null;
                              const field = fields.find(f => f.id === fieldId);
                              setFieldMappings(prev => prev.map((m, i) => 
                                i === index 
                                  ? { 
                                      ...m, 
                                      fieldId, 
                                      fieldName: field?.name || '',
                                      isRequired: field?.required || false
                                    }
                                  : m
                              ));
                            }}
                            className="w-full px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary text-sm focus:outline-none focus:border-border-focus"
                          >
                            <option value="">Do not map</option>
                            {fields.map(field => (
                              <option key={field.id} value={field.id}>
                                {field.name} {field.required && '*'}
                              </option>
                            ))}
                          </select>
                        </div>
                        
                        {mapping.isRequired && (
                          <Badge variant="destructive" className="text-xs">
                            Verplicht
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between">
                    <Button variant="ghost" onClick={() => setStep('upload')}>
                      Terug
                    </Button>
                    <Button onClick={startImport}>
                      Import starten
                    </Button>
                  </div>
                </div>
              )}

              {/* Import: Progress Step */}
              {step === 'progress' && (
                <div className="space-y-4">
                  <div className="text-center">
                    <h3 className="text-lg font-medium text-text-primary mb-2">
                      Gegevens importeren...
                    </h3>
                    <p className="text-text-secondary">
                      {importProgress.processed} van {importProgress.total} rijen verwerkt
                    </p>
                  </div>

                  <Progress 
                    value={importProgress.processed} 
                    max={importProgress.total}
                    className="h-3"
                  />

                  {importProgress.errors.length > 0 && (
                    <div className="p-3 bg-status-error/10 border border-status-error/30 rounded-md">
                      <div className="flex items-center gap-2 text-status-error text-sm font-medium mb-2">
                        <AlertCircle size={16} />
                        {importProgress.errors.length} fouten gevonden
                      </div>
                      <div className="space-y-1 text-sm text-status-error max-h-32 overflow-y-auto">
                        {importProgress.errors.slice(0, 5).map((error, i) => (
                          <div key={i}>{error}</div>
                        ))}
                        {importProgress.errors.length > 5 && (
                          <div>... en {importProgress.errors.length - 5} meer</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Import: Complete Step */}
              {step === 'complete' && (
                <div className="text-center space-y-4">
                  <Check className="w-12 h-12 text-status-success mx-auto" />
                  <h3 className="text-lg font-medium text-text-primary">
                    Import voltooid!
                  </h3>
                  <p className="text-text-secondary">
                    {importProgress.processed - importProgress.errors.length} van {importProgress.total} rijen succesvol geïmporteerd
                  </p>
                  
                  {importProgress.errors.length > 0 && (
                    <Button
                      variant="ghost"
                      onClick={() => setShowErrors(!showErrors)}
                    >
                      <ChevronDown 
                        size={16} 
                        className={cn(
                          'transition-transform',
                          showErrors && 'rotate-180'
                        )} 
                      />
                      Toon fouten ({importProgress.errors.length})
                    </Button>
                  )}

                  {showErrors && (
                    <div className="text-left p-3 bg-status-error/10 border border-status-error/30 rounded-md max-h-40 overflow-y-auto">
                      {importProgress.errors.map((error, i) => (
                        <div key={i} className="text-sm text-status-error">
                          {error}
                        </div>
                      ))}
                    </div>
                  )}

                  <Button onClick={onClose}>
                    Sluiten
                  </Button>
                </div>
              )}
            </>
          ) : (
            /* Export */
            <div className="space-y-4">
              <div className="text-center">
                <Download className="w-12 h-12 text-accent mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-primary mb-2">
                  Exporteer je gegevens
                </h3>
                <p className="text-text-secondary">
                  {records.length} records uit {activeTable?.name}
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Bestandsformaat
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setExportFormat('csv')}
                      className={cn(
                        'p-3 border rounded-md text-left transition-colors',
                        exportFormat === 'csv'
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-border-light'
                      )}
                    >
                      <FileText size={20} className="mb-1" />
                      <div className="font-medium">CSV</div>
                      <div className="text-xs text-text-secondary">
                        Voor Excel en andere tools
                      </div>
                    </button>
                    
                    <button
                      onClick={() => setExportFormat('json')}
                      className={cn(
                        'p-3 border rounded-md text-left transition-colors',
                        exportFormat === 'json'
                          ? 'border-accent bg-accent/5'
                          : 'border-border hover:border-border-light'
                      )}
                    >
                      <FileText size={20} className="mb-1" />
                      <div className="font-medium">JSON</div>
                      <div className="text-xs text-text-secondary">
                        Voor ontwikkelaars
                      </div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="ghost" onClick={onClose}>
                  Annuleren
                </Button>
                <Button onClick={exportData}>
                  <Download size={16} />
                  Exporteren
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function parseCSV(text: string): CSVPreview {
  const lines = text.trim().split('\n');
  const delimiter = detectDelimiter(text);
  
  const headers = parseCSVLine(lines[0], delimiter);
  const rows = lines.slice(1).map(line => parseCSVLine(line, delimiter));
  
  return { headers, rows, delimiter };
}

function detectDelimiter(text: string): string {
  const delimiters = [',', ';', '\t'];
  const firstLine = text.split('\n')[0];
  
  let maxCount = 0;
  let bestDelimiter = ',';
  
  for (const delimiter of delimiters) {
    const count = firstLine.split(delimiter).length;
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delimiter;
    }
  }
  
  return bestDelimiter;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim());
  return result;
}

export { ImportExportDialog };
export default ImportExportDialog;