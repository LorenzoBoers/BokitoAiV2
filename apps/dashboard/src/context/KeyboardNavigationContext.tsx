import React, { createContext, useContext, useEffect, useCallback, useState } from 'react';

interface KeyboardNavigationContextValue {
  activeElement: string | null;
  setActiveElement: (elementId: string | null) => void;
  registerShortcut: (key: string, handler: () => void, deps?: any[]) => void;
  unregisterShortcut: (key: string) => void;
}

const KeyboardNavigationContext = createContext<KeyboardNavigationContextValue | null>(null);

export function KeyboardNavigationProvider({ children }: { children: React.ReactNode }) {
  const [activeElement, setActiveElement] = useState<string | null>(null);
  const [shortcuts, setShortcuts] = useState<Map<string, () => void>>(new Map());

  const registerShortcut = useCallback((key: string, handler: () => void, deps: any[] = []) => {
    setShortcuts(prev => new Map(prev.set(key, handler)));
  }, []);

  const unregisterShortcut = useCallback((key: string) => {
    setShortcuts(prev => {
      const newMap = new Map(prev);
      newMap.delete(key);
      return newMap;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Only handle specific shortcuts in input fields
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          e.preventDefault();
          return;
        }
        
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          // Find the nearest form and submit it
          const form = (e.target as HTMLElement).closest('form');
          if (form) {
            const submitButton = form.querySelector('button[type="submit"]') as HTMLButtonElement;
            if (submitButton) {
              submitButton.click();
              e.preventDefault();
              return;
            }
          }
        }
        
        return;
      }

      // Handle global shortcuts
      const shortcutKey = getShortcutKey(e);
      const handler = shortcuts.get(shortcutKey);
      
      if (handler) {
        e.preventDefault();
        handler();
        return;
      }

      // Handle navigation shortcuts
      switch (e.key) {
        case 'Escape':
          // Close modals, clear selections, etc.
          setActiveElement(null);
          const activeModal = document.querySelector('[role="dialog"]');
          if (activeModal) {
            const closeButton = activeModal.querySelector('[aria-label="Close"]') as HTMLButtonElement;
            if (closeButton) {
              closeButton.click();
            }
          }
          e.preventDefault();
          break;

        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          // Handle grid navigation
          handleArrowNavigation(e.key);
          e.preventDefault();
          break;

        case 'Enter':
          // Open record drawer or edit mode
          if (activeElement) {
            const element = document.getElementById(activeElement);
            if (element) {
              element.click();
            }
          }
          e.preventDefault();
          break;

        case 'Tab':
          // Let browser handle tab navigation
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, activeElement]);

  const value: KeyboardNavigationContextValue = {
    activeElement,
    setActiveElement,
    registerShortcut,
    unregisterShortcut,
  };

  return (
    <KeyboardNavigationContext.Provider value={value}>
      {children}
    </KeyboardNavigationContext.Provider>
  );
}

export function useKeyboardNavigation() {
  const context = useContext(KeyboardNavigationContext);
  if (!context) {
    throw new Error('useKeyboardNavigation must be used within KeyboardNavigationProvider');
  }
  return context;
}

function getShortcutKey(e: KeyboardEvent): string {
  const modifiers = [];
  if (e.ctrlKey) modifiers.push('ctrl');
  if (e.metaKey) modifiers.push('cmd');
  if (e.altKey) modifiers.push('alt');
  if (e.shiftKey) modifiers.push('shift');
  
  return [...modifiers, e.key.toLowerCase()].join('+');
}

function handleArrowNavigation(key: string) {
  // Find the currently focused grid cell or table row
  const activeElement = document.activeElement;
  if (!activeElement) return;

  const isGridCell = activeElement.closest('[role="gridcell"]');
  const isTableRow = activeElement.closest('tr');
  
  if (isGridCell || isTableRow) {
    const container = activeElement.closest('[role="grid"], table');
    if (!container) return;

    let nextElement: Element | null = null;

    switch (key) {
      case 'ArrowUp':
        nextElement = findAdjacentElement(activeElement, 'up', container);
        break;
      case 'ArrowDown':
        nextElement = findAdjacentElement(activeElement, 'down', container);
        break;
      case 'ArrowLeft':
        nextElement = findAdjacentElement(activeElement, 'left', container);
        break;
      case 'ArrowRight':
        nextElement = findAdjacentElement(activeElement, 'right', container);
        break;
    }

    if (nextElement && nextElement instanceof HTMLElement) {
      nextElement.focus();
    }
  }
}

function findAdjacentElement(current: Element, direction: 'up' | 'down' | 'left' | 'right', container: Element): Element | null {
  // This is a simplified implementation
  // In a real implementation, you'd need to handle the grid structure properly
  const allFocusable = container.querySelectorAll('[tabindex="0"], button, input, [role="gridcell"]');
  const currentIndex = Array.from(allFocusable).indexOf(current);
  
  if (currentIndex === -1) return null;

  switch (direction) {
    case 'up':
    case 'left':
      return allFocusable[currentIndex - 1] || null;
    case 'down':
    case 'right':
      return allFocusable[currentIndex + 1] || null;
    default:
      return null;
  }
}