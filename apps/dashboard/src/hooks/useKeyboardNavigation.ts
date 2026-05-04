import { useEffect, useCallback, useRef } from 'react';

interface KeyboardNavigationConfig {
  onArrowUp?: () => void;
  onArrowDown?: () => void;
  onArrowLeft?: () => void;
  onArrowRight?: () => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onTab?: () => void;
  onShiftTab?: () => void;
  onCmdEnter?: () => void;
  enabled?: boolean;
  preventDefault?: boolean;
}

export function useKeyboardNavigation(config: KeyboardNavigationConfig) {
  const {
    onArrowUp,
    onArrowDown,
    onArrowLeft,
    onArrowRight,
    onEnter,
    onEscape,
    onTab,
    onShiftTab,
    onCmdEnter,
    enabled = true,
    preventDefault = true,
  } = config;

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabled) return;

    const { key, metaKey, ctrlKey, shiftKey } = event;

    // Handle Cmd/Ctrl + Enter
    if ((metaKey || ctrlKey) && key === 'Enter' && onCmdEnter) {
      if (preventDefault) event.preventDefault();
      onCmdEnter();
      return;
    }

    // Handle regular keys
    switch (key) {
      case 'ArrowUp':
        if (onArrowUp) {
          if (preventDefault) event.preventDefault();
          onArrowUp();
        }
        break;
      case 'ArrowDown':
        if (onArrowDown) {
          if (preventDefault) event.preventDefault();
          onArrowDown();
        }
        break;
      case 'ArrowLeft':
        if (onArrowLeft) {
          if (preventDefault) event.preventDefault();
          onArrowLeft();
        }
        break;
      case 'ArrowRight':
        if (onArrowRight) {
          if (preventDefault) event.preventDefault();
          onArrowRight();
        }
        break;
      case 'Enter':
        if (onEnter) {
          if (preventDefault) event.preventDefault();
          onEnter();
        }
        break;
      case 'Escape':
        if (onEscape) {
          if (preventDefault) event.preventDefault();
          onEscape();
        }
        break;
      case 'Tab':
        if (shiftKey && onShiftTab) {
          if (preventDefault) event.preventDefault();
          onShiftTab();
        } else if (!shiftKey && onTab) {
          if (preventDefault) event.preventDefault();
          onTab();
        }
        break;
    }
  }, [
    enabled,
    preventDefault,
    onArrowUp,
    onArrowDown,
    onArrowLeft,
    onArrowRight,
    onEnter,
    onEscape,
    onTab,
    onShiftTab,
    onCmdEnter,
  ]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown, enabled]);
}

// Hook for managing focus within a grid/table
export function useGridNavigation(config: {
  rows: number;
  columns: number;
  onCellSelect: (row: number, col: number) => void;
  onCellEdit?: (row: number, col: number) => void;
  onCellSave?: () => void;
  currentRow?: number;
  currentCol?: number;
  enabled?: boolean;
}) {
  const {
    rows,
    columns,
    onCellSelect,
    onCellEdit,
    onCellSave,
    currentRow = 0,
    currentCol = 0,
    enabled = true,
  } = config;

  const currentRowRef = useRef(currentRow);
  const currentColRef = useRef(currentCol);

  // Update refs when props change
  useEffect(() => {
    currentRowRef.current = currentRow;
    currentColRef.current = currentCol;
  }, [currentRow, currentCol]);

  useKeyboardNavigation({
    enabled,
    onArrowUp: () => {
      const newRow = Math.max(0, currentRowRef.current - 1);
      onCellSelect(newRow, currentColRef.current);
    },
    onArrowDown: () => {
      const newRow = Math.min(rows - 1, currentRowRef.current + 1);
      onCellSelect(newRow, currentColRef.current);
    },
    onArrowLeft: () => {
      const newCol = Math.max(0, currentColRef.current - 1);
      onCellSelect(currentRowRef.current, newCol);
    },
    onArrowRight: () => {
      const newCol = Math.min(columns - 1, currentColRef.current + 1);
      onCellSelect(currentRowRef.current, newCol);
    },
    onEnter: () => {
      if (onCellEdit) {
        onCellEdit(currentRowRef.current, currentColRef.current);
      }
    },
    onCmdEnter: () => {
      if (onCellSave) {
        onCellSave();
      }
    },
  });
}