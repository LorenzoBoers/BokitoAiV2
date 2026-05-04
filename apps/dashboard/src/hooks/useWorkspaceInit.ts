import { useEffect, useRef, useState } from 'react';
import { useDatabase } from '../context/DatabaseContext';

function isMissingStandardTablesRoute(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes('404') ||
    m.includes('unable to locate') ||
    m.includes('not found') ||
    m.includes('locate request')
  );
}

export function useWorkspaceInit() {
  const { tables, tablesLoading, createStandardTables } = useDatabase();
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  /** One bootstrap attempt per hook instance — avoids infinite loops (never put isInitializing in effect deps). */
  const bootstrapStartedRef = useRef(false);

  useEffect(() => {
    if (tablesLoading) return;
    if (tables.some((t) => t.is_standard)) return;
    if (bootstrapStartedRef.current) return;
    bootstrapStartedRef.current = true;

    let cancelled = false;

    const run = async () => {
      setIsInitializing(true);
      setInitError(null);
      try {
        await createStandardTables();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!isMissingStandardTablesRoute(msg)) {
          console.error('Failed to initialize workspace with standard tables:', error);
          setInitError(msg || 'Failed to create standard tables');
        }
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [tables, tablesLoading, createStandardTables]);

  return {
    isInitializing,
    initError,
  };
}