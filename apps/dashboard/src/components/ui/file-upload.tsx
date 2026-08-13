import { useCallback, useState } from 'react';
import { Upload, File, X, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  onFileRemove?: () => void;
  accept?: string;
  maxSize?: number; // in bytes
  disabled?: boolean;
  multiple?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function FileUpload({
  onFileSelect,
  onFileRemove,
  accept,
  maxSize = 10 * 1024 * 1024, // 10MB default
  disabled = false,
  multiple = false,
  className,
  children,
}: FileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (maxSize && file.size > maxSize) {
      return `File is too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)}MB.`;
    }
    
    if (accept) {
      const acceptedTypes = accept.split(',').map(type => type.trim());
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
      const mimeType = file.type;
      
      const isAccepted = acceptedTypes.some(acceptedType => {
        if (acceptedType.startsWith('.')) {
          return fileExtension === acceptedType.toLowerCase();
        }
        if (acceptedType.includes('*')) {
          const baseType = acceptedType.split('/')[0];
          return mimeType.startsWith(baseType);
        }
        return mimeType === acceptedType;
      });
      
      if (!isAccepted) {
        return `File type not supported. Allowed types: ${accept}`;
      }
    }
    
    return null;
  }, [accept, maxSize]);

  const handleFileSelect = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }
    
    setError(null);
    setSelectedFile(file);
    onFileSelect(file);
  }, [validateFile, onFileSelect]);

  const handleFileRemove = useCallback(() => {
    setSelectedFile(null);
    setError(null);
    onFileRemove?.();
  }, [onFileRemove]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (disabled) return;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [disabled, handleFileSelect]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  }, [handleFileSelect]);

  if (selectedFile && !error) {
    return (
      <div className={cn(
        'flex items-center justify-between p-4 border border-border rounded-lg bg-bg-surface',
        className
      )}>
        <div className="flex items-center gap-3">
          <File className="h-5 w-5 text-text-secondary" />
          <div>
            <p className="text-sm font-medium text-text-primary">{selectedFile.name}</p>
            <p className="text-xs text-text-secondary">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <button
          onClick={handleFileRemove}
          className="p-1 hover:bg-bg-muted rounded-md transition-colors"
          disabled={disabled}
        >
          <X className="h-4 w-4 text-text-secondary" />
        </button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className={cn(
          'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          isDragOver && !disabled
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-border-focus',
          disabled && 'opacity-50 cursor-not-allowed',
          error && 'border-status-error bg-status-error/5'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={handleInputChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        
        {children || (
          <div className="space-y-3">
            <Upload className={cn(
              'mx-auto h-12 w-12',
              error ? 'text-status-error' : 'text-text-muted'
            )} />
            <div>
              <p className="text-sm font-medium text-text-primary">
                Drag a file here or click to select
              </p>
              <p className="text-xs text-text-secondary mt-1">
                {accept && `Ondersteunde formaten: ${accept}`}
                {maxSize && ` • Max ${Math.round(maxSize / 1024 / 1024)}MB`}
              </p>
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-status-error/10 border border-status-error/30">
          <AlertCircle className="h-4 w-4 text-status-error flex-shrink-0" />
          <p className="text-sm text-status-error">{error}</p>
        </div>
      )}
    </div>
  );
}