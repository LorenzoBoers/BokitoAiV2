import { useState, useCallback } from 'react';
import { X, Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { FileUpload } from '../ui/file-upload';
import { Progress } from '../ui/progress';
import { useDatabase } from '../../context/DatabaseContext';
import type { CSVImportConfig, ImportProgress, CustomField } from '../../types/custom-db';

interface CSVImportProps {
  onClose: () => void;
}

type ImportStep = 'upload' | 'configure' | 'mapping' | 'importing' | 'complete';

export default function CSVImport({ onClose }: CSVImportProps) {
  const { activeTable, fields, addRecord } = useDatabase();
  const [currentStep, setCurrentStep] = useState<ImportStep>('upload');
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [config, setConfig] = useState<CSVImportConfig>({
    delimiter: ',',
    hasHeader: true,
    encoding: 'utf-8',
    fieldMappings: {},
  });
  const [progress, setProgress] = useState<ImportProgress>({
    total: 0,
    processed: 0,
    errors: [],
    isComplete: false,
  });

  const detectDelimiter = useCallback((content: string): ',' | ';' | '\t' | '|' => {
    const delimiters = [',', ';', '\t', '|'] as const;
    const counts = delimiters.map(delimiter => 
      (content.match(new RegExp(`\\${delimiter}`, 'g')) || []).length
    );
    const maxIndex = counts.indexOf(Math.max(...counts));
    return delimiters[maxIndex];
  }, []);

  const parseCSV = useCallback((content: string, delimiter: string): string[][] => {
    const lines = content.split('\n').filter(line => line.trim());
    return lines.map(line => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === delimiter && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      
      values.push(current.trim());
      return values;
    });
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setCsvFile(file);
    
    try {
      const content = await file.text();
      const detectedDelimiter = detectDelimiter(content);
      const parsedData = parseCSV(content, detectedDelimiter);
      
      setCsvData(parsedData);
      setConfig(prev => ({
        ...prev,
        delimiter: detectedDelimiter,
        hasHeader: parsedData.length > 0 && parsedData[0].every(cell => 
          isNaN(Number(cell)) && cell.length > 0
        ),
      }));
      
      setCurrentStep('configure');
    } catch (error) {
      console.error('Failed to parse CSV:', error);
    }
  }, [detectDelimiter, parseCSV]);

  const handleConfigChange = (updates: Partial<CSVImportConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    
    if (updates.delimiter && csvFile) {
      // Re-parse with new delimiter
      csvFile.text().then(content => {
        const parsedData = parseCSV(content, newConfig.delimiter);
        setCsvData(parsedData);
      });
    }
  };

  const handleMapping = () => {
    if (csvData.length === 0) return;
    
    const headers = config.hasHeader ? csvData[0] : csvData[0].map((_, i) => `Column ${i + 1}`);
    const initialMappings: Record<string, string> = {};
    
    // Auto-map similar field names
    headers.forEach((header, index) => {
      const normalizedHeader = header.toLowerCase().trim();
      const matchingField = fields.find(field => 
        field.name.toLowerCase().includes(normalizedHeader) ||
        normalizedHeader.includes(field.name.toLowerCase())
      );
      
      if (matchingField) {
        initialMappings[`col_${index}`] = matchingField.slug;
      }
    });
    
    setConfig(prev => ({ ...prev, fieldMappings: initialMappings }));
    setCurrentStep('mapping');
  };

  const handleImport = async () => {
    if (!activeTable || csvData.length === 0) return;
    
    setCurrentStep('importing');
    const dataRows = config.hasHeader ? csvData.slice(1) : csvData;
    const headers = config.hasHeader ? csvData[0] : csvData[0].map((_, i) => `col_${i}`);
    
    setProgress({
      total: dataRows.length,
      processed: 0,
      errors: [],
      isComplete: false,
    });

    const errors: ImportProgress['errors'] = [];
    let processed = 0;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowData: Record<string, unknown> = {};
      
      try {
        // Map CSV columns to table fields
        headers.forEach((_header, colIndex) => {
          const fieldSlug = config.fieldMappings[`col_${colIndex}`];
          if (fieldSlug && row[colIndex] !== undefined) {
            const field = fields.find(f => f.slug === fieldSlug);
            if (field) {
              rowData[fieldSlug] = convertValue(row[colIndex], field);
            }
          }
        });

        await addRecord(rowData);
        processed++;
      } catch (error) {
        errors.push(`Rij ${i + (config.hasHeader ? 2 : 1)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      setProgress({
        total: dataRows.length,
        processed,
        errors,
        isComplete: false,
      });
    }

    setProgress(prev => ({ ...prev, isComplete: true }));
    setCurrentStep('complete');
  };

  const convertValue = (value: string, field: CustomField): unknown => {
    if (!value || value.trim() === '') return null;
    
    switch (field.field_type) {
      case 'number':
        const num = Number(value);
        return isNaN(num) ? null : num;
      case 'boolean':
        return ['true', '1', 'yes', 'ja'].includes(value.toLowerCase());
      case 'date':
        const date = new Date(value);
        return isNaN(date.getTime()) ? null : date.toISOString();
      default:
        return value.trim();
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'upload':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <Upload className="w-12 h-12 text-accent mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                CSV bestand uploaden
              </h3>
              <p className="text-text-secondary">
                Sleep een CSV bestand hierheen of klik om te selecteren
              </p>
            </div>
            
            <FileUpload
              onFileSelect={handleFileSelect}
              accept=".csv,text/csv"
              maxSize={50 * 1024 * 1024} // 50MB
            />
          </div>
        );

      case 'configure':
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                Configureer import
              </h3>
              <p className="text-text-secondary">
                Controleer de instellingen voor je CSV bestand
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Scheidingsteken
                </label>
                <select
                  value={config.delimiter}
                  onChange={(e) => handleConfigChange({ delimiter: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary focus:outline-none focus:border-border-focus transition"
                >
                  <option value=",">Komma (,)</option>
                  <option value=";">Puntkomma (;)</option>
                  <option value="\t">Tab</option>
                  <option value="|">Pipe (|)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Encoding
                </label>
                <select
                  value={config.encoding}
                  onChange={(e) => handleConfigChange({ encoding: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary focus:outline-none focus:border-border-focus transition"
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="latin1">Latin-1</option>
                </select>
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={config.hasHeader}
                  onChange={(e) => handleConfigChange({ hasHeader: e.target.checked })}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span className="text-sm text-text-secondary">
                  Eerste rij bevat kolomnamen
                </span>
              </label>
            </div>

            {/* Preview */}
            {csvData.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="p-3 bg-bg-muted border-b border-border">
                  <h4 className="text-sm font-medium text-text-secondary">
                    Preview ({csvData.length} rows)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {csvData[0]?.map((header, index) => (
                          <th key={index} className="px-3 py-2 text-left text-text-secondary font-medium">
                            {config.hasHeader ? header : `Column ${index + 1}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csvData.slice(config.hasHeader ? 1 : 0, 4).map((row, rowIndex) => (
                        <tr key={rowIndex} className="border-b border-border">
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="px-3 py-2 text-text-primary">
                              {cell || '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleMapping}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
              >
                Next: Map fields
              </button>
            </div>
          </div>
        );

      case 'mapping':
        const headers = config.hasHeader ? csvData[0] : csvData[0]?.map((_, i) => `Column ${i + 1}`) || [];
        
        return (
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                Map fields
              </h3>
              <p className="text-text-secondary">
                Koppel CSV kolommen aan je tabelvelden
              </p>
            </div>

            <div className="space-y-4">
              {headers.map((header, index) => (
                <div key={index} className="flex items-center gap-4 p-3 border border-border rounded-lg">
                  <div className="flex-1">
                    <p className="font-medium text-text-primary">{header}</p>
                    <p className="text-sm text-text-muted">
                      Preview: {csvData[config.hasHeader ? 1 : 0]?.[index] || '-'}
                    </p>
                  </div>
                  <div className="w-48">
                    <select
                      value={config.fieldMappings[`col_${index}`] || ''}
                      onChange={(e) => handleConfigChange({
                        fieldMappings: {
                          ...config.fieldMappings,
                          [`col_${index}`]: e.target.value,
                        }
                      })}
                      className="w-full px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary focus:outline-none focus:border-border-focus transition"
                    >
                      <option value="">Do not map</option>
                      {fields.map((field) => (
                        <option key={field.id} value={field.slug}>
                          {field.name} ({field.field_type})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => setCurrentStep('configure')}
                className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
              >
                Vorige
              </button>
              <button
                onClick={handleImport}
                disabled={Object.keys(config.fieldMappings).length === 0}
                className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Importeren starten
              </button>
            </div>
          </div>
        );

      case 'importing':
        return (
          <div className="space-y-6 text-center">
            <div>
              <Upload className="w-12 h-12 text-accent mx-auto mb-4 animate-pulse" />
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                Importing...
              </h3>
              <p className="text-text-secondary">
                Even geduld terwijl we je data importeren
              </p>
            </div>

            <Progress
              value={progress.processed}
              max={progress.total}
              className="max-w-md mx-auto"
            />

            <div className="text-sm text-text-secondary">
              {progress.processed} van {progress.total} rijen verwerkt
              {progress.errors.length > 0 && (
                <span className="text-status-warning ml-2">
                  ({progress.errors.length} fouten)
                </span>
              )}
            </div>
          </div>
        );

      case 'complete':
        const successCount = progress.processed;
        const errorCount = progress.errors.length;
        
        return (
          <div className="space-y-6 text-center">
            <div>
              <CheckCircle className="w-12 h-12 text-status-success mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-text-heading mb-2">
                Import voltooid!
              </h3>
              <p className="text-text-secondary">
                {successCount} rijen succesvol geïmporteerd
                {errorCount > 0 && `, ${errorCount} fouten`}
              </p>
            </div>

            {errorCount > 0 && (
              <div className="max-w-md mx-auto">
                <div className="p-4 bg-status-warning/10 border border-status-warning/30 rounded-lg text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-status-warning" />
                    <span className="text-sm font-medium text-status-warning">
                      Fouten tijdens import
                    </span>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {progress.errors.slice(0, 5).map((error, index) => (
                      <p key={index} className="text-xs text-text-secondary">
                        {error}
                      </p>
                    ))}
                    {progress.errors.length > 5 && (
                      <p className="text-xs text-text-muted">
                        En {progress.errors.length - 5} meer...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={onClose}
              className="px-6 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
            >
              Sluiten
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface border border-border rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="text-xl font-semibold text-text-heading">
            CSV Import
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="p-6">
          {renderStep()}
        </div>
      </div>
    </div>
  );
}