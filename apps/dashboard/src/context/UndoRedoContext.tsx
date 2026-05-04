import React, { createContext, useContext, useCallback, useState, useEffect } from 'react';
import type { UndoRedoAction } from '../types/custom-db';
import { toast } from 'sonner';

interface UndoRedoContextValue {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  addAction: (action: Omit<UndoRedoAction, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
}

const UndoRedoContext = createContext<UndoRedoContextValue | null>(null);

const MAX_HISTORY = 30;

export function UndoRedoProvider({ children }: { children: React.ReactNode }) {
  const [undoStack, setUndoStack] = useState<UndoRedoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoRedoAction[]>([]);

  const addAction = useCallback((actionData: Omit<UndoRedoAction, 'id' | 'timestamp'>) => {
    const action: UndoRedoAction = {
      ...actionData,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    setUndoStack(prev => {
      const newStack = [...prev, action];
      return newStack.slice(-MAX_HISTORY);
    });
    setRedoStack([]);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;

    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, action]);

    // Show toast notification
    toast.success(`${getActionDescription(action)} ongedaan gemaakt`, {
      action: {
        label: 'Opnieuw',
        onClick: () => redo(),
      },
    });
  }, [undoStack]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;

    const action = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, action]);

    toast.success(`${getActionDescription(action)} opnieuw uitgevoerd`);
  }, [redoStack]);

  const clearHistory = useCallback(() => {
    setUndoStack([]);
    setRedoStack([]);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const value: UndoRedoContextValue = {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undo,
    redo,
    addAction,
    clearHistory,
  };

  return <UndoRedoContext.Provider value={value}>{children}</UndoRedoContext.Provider>;
}

export function useUndoRedo() {
  const context = useContext(UndoRedoContext);
  if (!context) {
    throw new Error('useUndoRedo must be used within UndoRedoProvider');
  }
  return context;
}

function getActionDescription(action: UndoRedoAction): string {
  const entityName = {
    table: 'Tabel',
    field: 'Veld',
    record: 'Record',
    view: 'Weergave',
  }[action.entity];

  const actionName = {
    create: 'aanmaken',
    update: 'wijziging',
    delete: 'verwijdering',
  }[action.type];

  return `${entityName} ${actionName}`;
}