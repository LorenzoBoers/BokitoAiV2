import { useState, useCallback } from 'react';
import { Upload, X, FileText, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { cn } from '../../lib/utils';
import { useDatabase } from '../../context/DatabaseContext';
import { importCSV } from '../../lib/custom-db-api';
import type { CSVImportMapping, CSVImportResult } from '../../types/custom-db';
import { toast } from 'sonner';

interface CSVImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedCSV {
  headers: string[];
  rows: string[][];
  delimiter: string;
  hasHeaders: boolean;
}

export default function CSVImportDialog({ isOpen, onClose }: CSVImportDialogProps) {
  const { activeTable, fields } = useDatabase();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedCSV | null>(null);
  const [mapping, setMapping] = useState<CSVImportMapping[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<CSVImportResult | null>(null);
  const [step, setStep] = useState<'upload' | 'mapping' | 'importing' | 'result'>('upload');

  const detectDelimiter = useCallback((content: string): string => {
    const delimiters = [',', ';', '\t', '|'];
    const firstLine = content.split('\n')[0];
    
    let bestDelimiter = ',';
    let maxCount = 0;
    
    for (const delimiter of delimiters) {
      const count = (firstLine.match(new RegExp(delimiter, 'g')) || []).length;
      if (count > maxCount) {
        maxCount = count;
        bestDelimiter = delimiter;
      }
    }
    
    return bestDelimiter;
  }, []);

  const parseCSV = useCallback((content: string, delimiter: string): string[][] => {
    const lines = content.split('\n').filter(line => line.trim());
    const result: string[][] = [];
    
    for (const line of lines) {
      const row: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          row.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      row.push(current.trim());
      result.push(row);
    }
    
    return result;
  }, []);

  const handleFileUpload = useCallback(async (uploadedFile: File) => {
    try {
      const content = await uploadedFile.text();
      const delimiter = detectDelimiter(content);
      const rows = parseCSV(content, delimiter);
      
      if (rows.length === 0) {
        toast.error('Het CSV-bestand is leeg');
        return;
      }
      
      const hasHeaders = rows.length > 1 && rows[0].every(cell => 
        isNaN(Number(cell)) || cell.trim() === ''
      );
      
      const headers = hasHeaders ? rows[0] : rows[0].map((_, i) => `Kolom ${i + 1}`);
      const dataRows = hasHeaders ? rows.slice(1) : rows;
      
      setParsedData({
        headers,
        rows: dataRows,
        delimiter,
        hasHeaders,
      });
      
      // Initialize mapping
      const initialMapping: CSVImportMapping[] = headers.map(header => {
        // Try to find matching field by name
        const matchingField = fields.find(field => 
          field.name.toLowerCase() === header.toLowerCase() ||
          field.slug.toLowerCase() === header.toLowerCase()
        );
        
        return {
          csvColumn: header,
          fieldSlug: matchingField?.slug || '',
          fieldType: matchingField?.field_type || 'text',
          transform: 'none',
        };
      });
      
      setMapping(initialMapping);
      setStep('mapping');
    } catch (error) {
      toast.error('Fout bij het lezen van het CSV-bestand');
      console.error('CSV parsing error:', error);
    }
  }, [detectDelimiter, parseCSV, fields]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'text/csv') {
      setFile(droppedFile);
      void handleFileUpload(droppedFile);
    } else {
      toast.error('Selecteer een geldig CSV-bestand');
    }
  }, [handleFileUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      void handleFileUpload(selectedFile);
    }
  }, [handleFileUpload]);

  const updateMapping = useCallback((index: number, updates: Partial<CSVImportMapping>) => {
    setMapping(prev => prev.map((item, i) => 
      i === index ? { ...item, ...updates } : item
    ));
  }, []);

  const handleImport = useCallback(async () => {
    if (!activeTable || !file || !parsedData) return;
    
    const validMappings = mapping.filter(m => m.fieldSlug);
    if (validMappings.length === 0) {
      toast.error('Selecteer minimaal één veld om te importeren');
      return;
    }
    
    setIsImporting(true);
    setStep('importing');
    
    try {
      const result = await importCSV(activeTable.id, file, validMappings, {
        hasHeaders: parsedData.hasHeaders,
        delimiter: parsedData.delimiter,
      });
      
      setImportResult(result);
      setStep('result');
      
      if (result.success) {
        toast.success(`${result.imported} records succesvol geïmporteerd`);
      } else {
        toast.error('Import voltooid met fouten');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onbekende fout';
      toast.error(`Import failed: ${message}`);
      setStep('mapping');
    } finally {
      setIsImporting(false);
    }
  }, [activeTable, file, parsedData, mapping]);

  const reset = useCallback(() => {
    setFile(null);
    setParsedData(null);
    setMapping([]);
    setImportResult(null);
    setStep('upload');
    setIsImporting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>CSV Importeren</CardTitle>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent>
          {step === 'upload' && (
            <div className="space-y-6">
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-border hover:border-border-focus rounded-lg p-8 text-center transition-colors"
              >
                <Upload size={48} className="mx-auto text-text-muted mb-4" />
                <h3 className="text-lg font-semibold text-text-heading mb-2">
                  Sleep je CSV-bestand hierheen
                </h3>
                <p className="text-text-muted mb-4">
                  Of klik om een bestand te selecteren
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="csv-upload"
                />
                <label htmlFor="csv-upload">
                  <Button variant="secondary" className="cursor-pointer">
                    Bestand selecteren
                  </Button>
                </label>
              </div>
              
              <div className="text-sm text-text-muted">
                <h4 className="font-medium mb-2">Ondersteunde formaten:</h4>
                <ul className="space-y-1">
                  <li>• CSV-bestanden (.csv)</li>
                  <li>• Scheidingstekens: komma, puntkomma, tab, pipe</li>
                  <li>• UTF-8 encoding aanbevolen</li>
                </ul>
              </div>
            </div>
          )}

          {step === 'mapping' && parsedData && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-3 bg-bg-surface rounded-lg">
                <FileText size={20} className="text-accent" />
                <div>
                  <p className="font-medium">{file?.name}</p>
                  <p className="text-sm text-text-muted">
                    {parsedData.rows.length} rijen, {parsedData.headers.length} kolommen
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-4">Veld mapping</h3>
                <div className="space-y-3">
                  {mapping.map((item, index) => (
                    <div key={index} className="flex items-center gap-4 p-3 bg-bg-surface rounded-lg">
                      <div className="flex-1">
                        <p className="font-medium text-sm">{item.csvColumn}</p>
                        <p className="text-xs text-text-muted">CSV kolom</p>
                      </div>
                      <div className="flex-1">
                        <Select
                          value={item.fieldSlug}
                          onValueChange={(value) => {
                            const field = fields.find(f => f.slug === value);
                            updateMapping(index, {
                              fieldSlug: value,
                              fieldType: field?.field_type || 'text',
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecteer veld..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Do not import</SelectItem>
                            {fields.map(field => (
                              <SelectItem key={field.id} value={field.slug}>
                                {field.name} ({field.field_type})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep('upload')}>
                  Terug
                </Button>
                <Button onClick={handleImport} disabled={isImporting}>
                  {isImporting ? 'Importeren...' : 'Importeren'}
                </Button>
              </div>
            </div>
          )}

          {step === 'importing' && (
            <div className="text-center py-8">
              <Loader2 size={48} className="mx-auto animate-spin text-accent mb-4" />
              <h3 className="text-lg font-semibold mb-2">Importing...</h3>
              <p className="text-text-muted">Dit kan even duren</p>
            </div>
          )}

          {step === 'result' && importResult && (
            <div className="space-y-6">
              <div className={cn(
                'flex items-center gap-3 p-4 rounded-lg',
                importResult.success 
                  ? 'bg-status-success/10 text-status-success' 
                  : 'bg-status-warning/10 text-status-warning'
              )}>
                {importResult.success ? (
                  <CheckCircle size={24} />
                ) : (
                  <AlertCircle size={24} />
                )}
                <div>
                  <h3 className="font-semibold">
                    {importResult.success ? 'Import succesvol' : 'Import voltooid met fouten'}
                  </h3>
                  <p className="text-sm">
                    {importResult.imported} records geïmporteerd
                  </p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 text-status-error">
                    Fouten ({importResult.errors.length})
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importResult.errors.map((error, index) => (
                      <div key={index} className="text-sm text-status-error bg-status-error/10 p-2 rounded">
                        Rij {error.row}: {error.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {importResult.warnings.length > 0 && (
                <div>
                  <h4 className="font-medium mb-2 text-status-warning">
                    Waarschuwingen ({importResult.warnings.length})
                  </h4>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importResult.warnings.map((warning, index) => (
                      <div key={index} className="text-sm text-status-warning bg-status-warning/10 p-2 rounded">
                        Rij {warning.row}: {warning.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="secondary" onClick={reset}>
                  Nieuwe import
                </Button>
                <Button onClick={handleClose}>
                  Sluiten
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}