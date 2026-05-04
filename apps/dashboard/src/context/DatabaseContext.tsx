import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  CustomTable, CustomField, CustomRecord, CustomView,
  FieldType, FieldConfig, ViewType, ViewConfig, PaginatedResponse,
  MagicTableConfig, SemanticSearchResult, AIEnrichmentSuggestion, DuplicateDetection,
} from '../types/custom-db';
import * as api from '../lib/custom-db-api'
import { validateRecord, applyDefaultValues } from '../lib/field-validation';

// Helper functions for filtering and sorting
function applyFilters(records: CustomRecord[], filters: FilterGroup | null, fields: CustomField[]): CustomRecord[] {
  if (!filters) return records;
  
  return records.filter(record => evaluateFilterGroup(record, filters, fields));
}

function evaluateFilterGroup(record: CustomRecord, group: FilterGroup, fields: CustomField[]): boolean {
  const ruleResults = group.rules.map(rule => evaluateFilterRule(record, rule, fields));
  const groupResults = group.groups.map(nestedGroup => evaluateFilterGroup(record, nestedGroup, fields));
  
  const allResults = [...ruleResults, ...groupResults];
  
  if (allResults.length === 0) return true;
  
  return group.logicalOperator === 'AND' 
    ? allResults.every(result => result)
    : allResults.some(result => result);
}

function evaluateFilterRule(record: CustomRecord, rule: any, fields: CustomField[]): boolean {
  const field = fields.find(f => f.slug === rule.fieldSlug);
  if (!field) return true;
  
  const value = record.data?.[rule.fieldSlug];
  const filterValue = rule.value;
  
  switch (rule.operator) {
    case 'is':
      return value === filterValue;
    case 'is_not':
      return value !== filterValue;
    case 'contains':
      return typeof value === 'string' && typeof filterValue === 'string' 
        ? value.toLowerCase().includes(filterValue.toLowerCase())
        : false;
    case 'starts_with':
      return typeof value === 'string' && typeof filterValue === 'string'
        ? value.toLowerCase().startsWith(filterValue.toLowerCase())
        : false;
    case 'ends_with':
      return typeof value === 'string' && typeof filterValue === 'string'
        ? value.toLowerCase().endsWith(filterValue.toLowerCase())
        : false;
    case 'is_empty':
      return value === null || value === undefined || value === '';
    case 'is_not_empty':
      return value !== null && value !== undefined && value !== '';
    case 'eq':
      return Number(value) === Number(filterValue);
    case 'neq':
      return Number(value) !== Number(filterValue);
    case 'gt':
      return Number(value) > Number(filterValue);
    case 'lt':
      return Number(value) < Number(filterValue);
    case 'gte':
      return Number(value) >= Number(filterValue);
    case 'lte':
      return Number(value) <= Number(filterValue);
    case 'between':
      if (Array.isArray(filterValue) && filterValue.length === 2) {
        const numValue = Number(value);
        return numValue >= Number(filterValue[0]) && numValue <= Number(filterValue[1]);
      }
      return false;
    case 'date_is':
      return new Date(value as string).toDateString() === new Date(filterValue as string).toDateString();
    case 'date_before':
      return new Date(value as string) < new Date(filterValue as string);
    case 'date_after':
      return new Date(value as string) > new Date(filterValue as string);
    case 'date_within':
      return evaluateDateWithin(value as string, filterValue as string);
    case 'is_one_of':
      if (Array.isArray(filterValue)) {
        return filterValue.includes(value);
      }
      return false;
    case 'is_all_of':
      if (Array.isArray(filterValue) && Array.isArray(value)) {
        return filterValue.every(fv => value.includes(fv));
      }
      return false;
    case 'contains_record':
      return Array.isArray(value) && value.length > 0;
    case 'contains_no_record':
      return !Array.isArray(value) || value.length === 0;
    default:
      return true;
  }
}

function evaluateDateWithin(dateValue: string, withinValue: string): boolean {
  const date = new Date(dateValue);
  const now = new Date();
  
  switch (withinValue) {
    case 'today':
      return date.toDateString() === now.toDateString();
    case 'this_week':
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      return date >= startOfWeek && date <= endOfWeek;
    case 'this_month':
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    case 'last_7_days':
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(now.getDate() - 7);
      return date >= sevenDaysAgo && date <= now;
    case 'last_30_days':
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      return date >= thirtyDaysAgo && date <= now;
    case 'last_90_days':
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(now.getDate() - 90);
      return date >= ninetyDaysAgo && date <= now;
    default:
      return false;
  }
}

function applySorting(records: CustomRecord[], sorts: SortCriteria[], fields: CustomField[]): CustomRecord[] {
  if (!sorts || sorts.length === 0) return records;
  
  return [...records].sort((a, b) => {
    for (const sort of sorts) {
      const field = fields.find(f => f.slug === sort.fieldSlug);
      if (!field) continue;
      
      const aValue = a.data?.[sort.fieldSlug];
      const bValue = b.data?.[sort.fieldSlug];
      
      let comparison = 0;
      
      // Handle null/undefined values
      if (aValue == null && bValue == null) comparison = 0;
      else if (aValue == null) comparison = 1;
      else if (bValue == null) comparison = -1;
      else {
        // Type-specific comparison
        if (field.field_type === 'number' || field.field_type === 'currency' || field.field_type === 'rating') {
          comparison = Number(aValue) - Number(bValue);
        } else if (field.field_type === 'date') {
          comparison = new Date(aValue as string).getTime() - new Date(bValue as string).getTime();
        } else if (field.field_type === 'boolean') {
          comparison = (aValue ? 1 : 0) - (bValue ? 1 : 0);
        } else {
          // String comparison
          comparison = String(aValue).localeCompare(String(bValue));
        }
      }
      
      if (comparison !== 0) {
        return sort.direction === 'desc' ? -comparison : comparison;
      }
    }
    
    return 0;
  });
}

function applyGrouping(records: CustomRecord[], groupBy: GroupByConfig | null, fields: CustomField[]): Record<string, CustomRecord[]> {
  if (!groupBy) return { 'All Records': records };
  
  const field = fields.find(f => f.slug === groupBy.fieldSlug);
  if (!field) return { 'All Records': records };
  
  const groups: Record<string, CustomRecord[]> = {};
  
  records.forEach(record => {
    const value = record.data?.[groupBy.fieldSlug];
    let groupKey: string;
    
    if (field.field_type === 'date' && groupBy.groupType) {
      groupKey = formatDateGroup(value as string, groupBy.groupType);
    } else if (field.field_type === 'select' || field.field_type === 'multi_select') {
      groupKey = Array.isArray(value) ? value.join(', ') : String(value || 'No value');
    } else if (field.field_type === 'boolean') {
      groupKey = value ? 'True' : 'False';
    } else {
      groupKey = String(value || 'No value');
    }
    
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(record);
  });
  
  return groups;
}

function formatDateGroup(dateValue: string, groupType: 'day' | 'week' | 'month'): string {
  if (!dateValue) return 'No date';
  
  const date = new Date(dateValue);
  
  switch (groupType) {
    case 'day':
      return date.toLocaleDateString();
    case 'week':
      const startOfWeek = new Date(date);
      startOfWeek.setDate(date.getDate() - date.getDay());
      return `Week of ${startOfWeek.toLocaleDateString()}`;
    case 'month':
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    default:
      return date.toLocaleDateString();
  }
}

interface DatabaseContextValue {
  tables: CustomTable[];
  tablesLoading: boolean;
  activeTable: CustomTable | null;
  fields: CustomField[];
  fieldsLoading: boolean;
  records: CustomRecord[];
  filteredRecords: CustomRecord[];
  groupedRecords: Record<string, CustomRecord[]>;
  recordsPaging: { page: number; total: number; perPage: number };
  recordsLoading: boolean;
  views: CustomView[];
  activeView: CustomView | null;
  isTrashMode: boolean;

  setActiveTableById: (id: number | null, trashMode?: boolean) => void;
  setActiveViewById: (id: number | null) => void;
  loadRecordsPage: (page: number) => void;
  setTrashMode: (enabled: boolean) => void;

  createTable: (data: { name: string; description?: string; icon?: string; color?: string }) => Promise<CustomTable>;
  updateTable: (id: number, data: { name?: string; description?: string; icon?: string; color?: string }) => Promise<void>;
  removeTable: (id: number) => Promise<void>;
  createStandardTables: () => Promise<void>;

  addField: (data: { name: string; field_type: FieldType; config?: FieldConfig; required?: boolean; default_value?: DefaultValue }) => Promise<CustomField>;
  editField: (fieldId: number, data: { name?: string; config?: FieldConfig; required?: boolean; position?: number; default_value?: DefaultValue }) => Promise<void>;
  removeField: (fieldId: number) => Promise<void>;

  addRecord: (data: Record<string, unknown>) => Promise<CustomRecord>;
  editRecord: (recordId: number, data: Record<string, unknown>) => Promise<void>;
  removeRecord: (recordId: number) => Promise<void>;

  addView: (data: { name: string; view_type: ViewType; config?: ViewConfig }) => Promise<CustomView>;
  editView: (viewId: number, data: { name?: string; config?: ViewConfig }) => Promise<void>;
  removeView: (viewId: number) => Promise<void>;

  reorderTables: (activeId: number, overId: number) => void;
  reorderViews: (activeId: number, overId: number) => void;

  refreshTables: () => Promise<void>;

  // Magic Table functions
  updateMagicTableConfig: (tableId: number, config: Partial<MagicTableConfig>) => Promise<void>;
  syncMagicTable: (tableId: number) => Promise<void>;
  searchSemantic: (tableId: number, query: string, limit?: number) => Promise<SemanticSearchResult[]>;
  enrichRecordWithAI: (recordId: number, fieldSlugs: string[]) => Promise<AIEnrichmentSuggestion[]>;
  checkForDuplicates: (tableId: number, data: Record<string, unknown>) => Promise<DuplicateDetection[]>;
  suppressDuplicate: (tableId: number, recordId: number, duplicateId: number) => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [tables, setTables] = useState<CustomTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  const [activeTableId, setActiveTableId] = useState<number | null>(null);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [records, setRecords] = useState<CustomRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsPaging, setRecordsPaging] = useState({ page: 1, total: 0, perPage: 50 });
  const [views, setViews] = useState<CustomView[]>([]);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [isTrashMode, setIsTrashMode] = useState(false);

  const activeTable = useMemo(() => tables.find((t) => t.id === activeTableId) ?? null, [tables, activeTableId]);
  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) ?? null, [views, activeViewId]);

  // Process records with filtering, sorting, and grouping
  const filteredRecords = useMemo(() => {
    if (!activeView || activeView.view_type !== 'grid') return records;
    const gridConfig = activeView.config as GridViewConfig;
    return applyFilters(records, gridConfig.filters ?? null, fields);
  }, [records, activeView, fields]);

  const sortedRecords = useMemo(() => {
    if (!activeView || activeView.view_type !== 'grid') return filteredRecords;
    const gridConfig = activeView.config as GridViewConfig;
    return applySorting(filteredRecords, gridConfig.sort ?? [], fields);
  }, [filteredRecords, activeView, fields]);

  const groupedRecords = useMemo(() => {
    if (!activeView || activeView.view_type !== 'grid') return { 'All Records': sortedRecords };
    const gridConfig = activeView.config as GridViewConfig;
    return applyGrouping(sortedRecords, gridConfig.groupBy ?? null, fields);
  }, [sortedRecords, activeView, fields]);

  const refreshTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const [customTables, standardTables] = await Promise.all([
        api.listTables(),
        api.listStandardTables().catch(() => []),
      ]);
      
      const allTables = [
        ...(Array.isArray(standardTables) ? standardTables : []),
        ...(Array.isArray(customTables) ? customTables : []),
      ];
      
      setTables(allTables);
    } catch {
      setTables([]);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => { void refreshTables(); }, [refreshTables]);

  const loadTableData = useCallback(async (tableId: number, page = 1, trashMode = false) => {
    setFieldsLoading(true);
    setRecordsLoading(true);
    try {
      const [fieldList, viewList] = await Promise.all([
        api.listFields(tableId),
        api.listViews(tableId),
      ]);
      setFields(Array.isArray(fieldList) ? fieldList : []);
      setViews(Array.isArray(viewList) ? viewList : []);
      if (viewList.length > 0) setActiveViewId(viewList[0].id);
      else setActiveViewId(null);
    } catch {
      setFields([]);
      setViews([]);
    } finally {
      setFieldsLoading(false);
    }

    try {
      const res = await api.listRecords(tableId, page, 50, trashMode);
      if (Array.isArray(res)) {
        const filteredRecords = trashMode 
          ? res.filter(r => r.is_deleted) 
          : res.filter(r => !r.is_deleted);
        setRecords(filteredRecords);
        setRecordsPaging({ page: 1, total: filteredRecords.length, perPage: 50 });
      } else {
        const paged = res as PaginatedResponse<CustomRecord>;
        const filteredRecords = trashMode 
          ? (paged.items ?? []).filter(r => r.is_deleted)
          : (paged.items ?? []).filter(r => !r.is_deleted);
        setRecords(filteredRecords);
        setRecordsPaging({ page: paged.curPage ?? 1, total: filteredRecords.length, perPage: 50 });
      }
    } catch {
      setRecords([]);
      setRecordsPaging({ page: 1, total: 0, perPage: 50 });
    } finally {
      setRecordsLoading(false);
    }
  }, []);

  const setActiveTableById = useCallback((id: number | null, trashMode = false) => {
    setActiveTableId(id);
    setIsTrashMode(trashMode);
    if (id) void loadTableData(id, 1, trashMode);
    else {
      setFields([]);
      setRecords([]);
      setViews([]);
      setActiveViewId(null);
      setIsTrashMode(false);
    }
  }, [loadTableData]);

  const setTrashMode = useCallback((enabled: boolean) => {
    setIsTrashMode(enabled);
    if (activeTableId) {
      void loadTableData(activeTableId, 1, enabled);
    }
  }, [activeTableId, loadTableData]);

  const loadRecordsPage = useCallback((page: number) => {
    if (!activeTableId) return;
    setRecordsLoading(true);
    api.listRecords(activeTableId, page, 50, isTrashMode)
      .then((res) => {
        if (Array.isArray(res)) {
          const filteredRecords = isTrashMode 
            ? res.filter(r => r.is_deleted) 
            : res.filter(r => !r.is_deleted);
          setRecords(filteredRecords);
        } else {
          const paged = res as PaginatedResponse<CustomRecord>;
          const filteredRecords = isTrashMode 
            ? (paged.items ?? []).filter(r => r.is_deleted)
            : (paged.items ?? []).filter(r => !r.is_deleted);
          setRecords(filteredRecords);
          setRecordsPaging({ page: paged.curPage ?? page, total: filteredRecords.length, perPage: 50 });
        }
      })
      .catch(() => setRecords([]))
      .finally(() => setRecordsLoading(false));
  }, [activeTableId, isTrashMode]);

  const createTable = useCallback(async (data: Parameters<typeof api.createTable>[0]) => {
    let t: CustomTable;
    try {
      t = await api.createTable(data);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      // Defensive fallback if backend unique slug constraint still triggers.
      if (!message.includes('duplicate')) throw error;
      t = await api.createTable({
        ...data,
        name: `${data.name} ${Date.now().toString().slice(-4)}`,
      });
    }
    setTables((prev) => [...prev, t]);
    return t;
  }, []);

  const updateTable = useCallback(async (id: number, data: Parameters<typeof api.updateTable>[1]) => {
    const updated = await api.updateTable(id, data);
    setTables((prev) => prev.map((t) => (t.id === id ? { ...t, ...updated } : t)));
  }, []);

  const removeTable = useCallback(async (id: number) => {
    const table = tables.find(t => t.id === id);
    if (table?.is_standard) {
      throw new Error('Standaard tabellen kunnen niet worden verwijderd');
    }
    
    await api.deleteTable(id);
    setTables((prev) => prev.filter((t) => t.id !== id));
    if (activeTableId === id) {
      setActiveTableId(null);
      setFields([]);
      setRecords([]);
      setViews([]);
    }
  }, [activeTableId, tables]);

  const createStandardTables = useCallback(async () => {
    try {
      const standardTables = await api.createStandardTables();
      setTables((prev) => [...standardTables, ...prev.filter(t => !t.is_standard)]);
    } catch (error) {
      const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
      if (
        msg.includes('404') ||
        msg.includes('unable to locate') ||
        msg.includes('not found') ||
        msg.includes('locate request')
      ) {
        return;
      }
      console.error('Failed to create standard tables:', error);
      throw error;
    }
  }, []);

  const addField = useCallback(async (data: Parameters<typeof api.createField>[1]) => {
    if (!activeTableId) throw new Error('No active table');
    let f: CustomField;
    try {
      f = await api.createField(activeTableId, data);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      // Temporary fallback for slug collisions on backend.
      if (!message.includes('duplicate')) throw error;
      f = await api.createField(activeTableId, {
        ...data,
        name: `${data.name} ${Date.now().toString().slice(-4)}`,
      });
    }
    setFields((prev) => [...prev, f]);
    return f;
  }, [activeTableId]);

  const editField = useCallback(async (fieldId: number, data: Parameters<typeof api.updateField>[1]) => {
    const updated = await api.updateField(fieldId, data);
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...updated } : f)));
  }, []);

  const removeField = useCallback(async (fieldId: number) => {
    await api.deleteField(fieldId);
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
  }, []);

  const addRecord = useCallback(async (data: Record<string, unknown>) => {
    if (!activeTableId) throw new Error('No active table');
    
    // Apply default values
    const dataWithDefaults = applyDefaultValues(fields, data);
    
    // Validate the record
    const validationErrors = validateRecord(fields, dataWithDefaults);
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.map(e => e.message).join(', ');
      throw new Error(`Validatiefout: ${errorMessage}`);
    }
    
    const r = await api.createRecord(activeTableId, dataWithDefaults);
    setRecords((prev) => [...prev, r]);
    setRecordsPaging((p) => ({ ...p, total: p.total + 1 }));
    return r;
  }, [activeTableId, fields]);

  const editRecord = useCallback(async (recordId: number, data: Record<string, unknown>) => {
    // Get the current record to merge with updates
    const currentRecord = records.find(r => r.id === recordId);
    if (!currentRecord) throw new Error('Record not found');
    
    const mergedData = { ...currentRecord.data, ...data };
    
    // Validate the updated record
    const validationErrors = validateRecord(fields, mergedData);
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.map(e => e.message).join(', ');
      throw new Error(`Validatiefout: ${errorMessage}`);
    }
    
    const updated = await api.updateRecord(recordId, data);
    setRecords((prev) => prev.map((r) => (r.id === recordId ? { ...r, ...updated, data: mergedData } : r)));
  }, [records, fields]);

  const removeRecord = useCallback(async (recordId: number) => {
    await api.deleteRecord(recordId);
    setRecords((prev) => prev.filter((r) => r.id !== recordId));
    setRecordsPaging((p) => ({ ...p, total: Math.max(0, p.total - 1) }));
  }, []);

  const addView = useCallback(async (data: Parameters<typeof api.createView>[1]) => {
    if (!activeTableId) throw new Error('No active table');
    const v = await api.createView(activeTableId, data);
    setViews((prev) => [...prev, v]);
    return v;
  }, [activeTableId]);

  const editView = useCallback(async (viewId: number, data: Parameters<typeof api.updateView>[1]) => {
    const updated = await api.updateView(viewId, data);
    setViews((prev) => prev.map((v) => (v.id === viewId ? { ...v, ...updated } : v)));
  }, []);

  const removeView = useCallback(async (viewId: number) => {
    await api.deleteView(viewId);
    setViews((prev) => prev.filter((v) => v.id !== viewId));
    if (activeViewId === viewId) {
      setActiveViewId(null);
    }
  }, [activeViewId]);

  const setActiveViewById = useCallback((id: number | null) => setActiveViewId(id), []);

  const reorderTables = useCallback((activeId: number, overId: number) => {
    setTables((prev) => {
      const oldIdx = prev.findIndex((t) => t.id === activeId);
      const newIdx = prev.findIndex((t) => t.id === overId);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIdx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }, []);

  const reorderViews = useCallback((activeId: number, overId: number) => {
    setViews((prev) => {
      const oldIdx = prev.findIndex((v) => v.id === activeId);
      const newIdx = prev.findIndex((v) => v.id === overId);
      if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIdx, 1);
      next.splice(newIdx, 0, moved);
      return next;
    });
  }, []);

  // Magic Table functions
  const updateMagicTableConfig = useCallback(async (tableId: number, config: Partial<MagicTableConfig>) => {
    // Mock implementation - in real app this would call the API
    setTables((prev) => prev.map((t) => {
      if (t.id !== tableId) return t;
      const currentConfig = t.magic_table_config || { enabled: false, indexed_fields: [], sync_status: { state: 'stale' } };
      const updatedConfig = { ...currentConfig, ...config };
      return { ...t, magic_table_config: updatedConfig };
    }));
  }, []);

  const syncMagicTable = useCallback(async (tableId: number) => {
    // Mock sync process
    const table = tables.find(t => t.id === tableId);
    if (!table?.magic_table_config?.enabled) return;

    // Set syncing state
    await updateMagicTableConfig(tableId, {
      sync_status: { state: 'syncing', records_indexing: records.length }
    });

    // Simulate sync delay
    setTimeout(async () => {
      await updateMagicTableConfig(tableId, {
        sync_status: { state: 'up_to_date', message: `Synchronized at ${new Date().toLocaleTimeString()}` },
        last_sync_at: new Date().toISOString(),
        indexed_record_count: records.length,
        estimated_size: `${Math.round(records.length * 0.5)}KB`
      });
    }, 2000);
  }, [tables, records.length, updateMagicTableConfig]);

  const searchSemantic = useCallback(async (tableId: number, query: string, limit = 10): Promise<SemanticSearchResult[]> => {
    // Mock semantic search - in real app this would call the vector search API
    const filteredRecords = records.filter(record => {
      return Object.values(record.data).some(value => 
        typeof value === 'string' && value.toLowerCase().includes(query.toLowerCase())
      );
    });

    return filteredRecords.slice(0, limit).map((record, index) => ({
      ...record,
      relevance_score: Math.max(0.1, 1 - (index * 0.1)) // Mock relevance score
    }));
  }, [records]);

  const enrichRecordWithAI = useCallback(async (recordId: number, fieldSlugs: string[]): Promise<AIEnrichmentSuggestion[]> => {
    // Mock AI enrichment
    const record = records.find(r => r.id === recordId);
    if (!record) return [];

    const suggestions: AIEnrichmentSuggestion[] = [];
    
    for (const fieldSlug of fieldSlugs) {
      const field = fields.find(f => f.slug === fieldSlug);
      if (!field) continue;

      let suggestedValue: unknown = '';
      let confidence = Math.random() * 0.4 + 0.6; // 60-100% confidence

      switch (field.field_type) {
        case 'text':
          if (fieldSlug.includes('description')) {
            suggestedValue = 'AI-generated description based on available data and context.';
          } else if (fieldSlug.includes('category')) {
            suggestedValue = 'Business';
          } else if (fieldSlug.includes('sentiment')) {
            suggestedValue = 'Positive';
          } else {
            suggestedValue = `AI-suggested ${field.name.toLowerCase()}`;
          }
          break;
        case 'select':
          if (field.config.options && field.config.options.length > 0) {
            suggestedValue = field.config.options[0].value;
          }
          break;
        case 'number':
          suggestedValue = Math.floor(Math.random() * 100);
          break;
        case 'rating':
          suggestedValue = Math.floor(Math.random() * 5) + 1;
          break;
      }

      suggestions.push({
        field_slug: fieldSlug,
        field_name: field.name,
        suggested_value: suggestedValue,
        confidence
      });
    }

    return suggestions;
  }, [records, fields]);

  const checkForDuplicates = useCallback(async (tableId: number, data: Record<string, unknown>): Promise<DuplicateDetection[]> => {
    // Mock duplicate detection based on title/name fields
    const titleFields = ['title', 'name', 'subject'];
    const titleValue = titleFields.find(field => data[field])?.toString().toLowerCase();
    
    if (!titleValue) return [];

    const duplicates: DuplicateDetection[] = [];
    
    for (const record of records) {
      for (const field of titleFields) {
        const recordValue = record.data[field]?.toString().toLowerCase();
        if (recordValue && recordValue.includes(titleValue) && recordValue !== titleValue) {
          duplicates.push({
            possible_duplicate_id: record.id,
            possible_duplicate_name: recordValue,
            similarity_score: Math.random() * 0.3 + 0.7 // 70-100% similarity
          });
          break;
        }
      }
    }

    return duplicates.slice(0, 3); // Return max 3 duplicates
  }, [records]);

  const suppressDuplicate = useCallback(async (tableId: number, recordId: number, duplicateId: number) => {
    // Mock suppression - in real app this would store the suppression
    console.log(`Suppressed duplicate detection between ${recordId} and ${duplicateId}`);
  }, []);

  const value = useMemo<DatabaseContextValue>(() => ({
    tables, tablesLoading, activeTable,
    fields, fieldsLoading,
    records, filteredRecords, groupedRecords, recordsPaging, recordsLoading,
    views, activeView,
    setActiveTableById, setActiveViewById, loadRecordsPage,
    createTable, updateTable, removeTable, createStandardTables,
    addField, editField, removeField,
    addRecord, editRecord, removeRecord,
    addView, editView, removeView,
    reorderTables, reorderViews,
    refreshTables,
    updateMagicTableConfig, syncMagicTable, searchSemantic,
    enrichRecordWithAI, checkForDuplicates, suppressDuplicate,
  }), [
    tables, tablesLoading, activeTable,
    fields, fieldsLoading,
    records, filteredRecords, groupedRecords, recordsPaging, recordsLoading,
    views, activeView,
    setActiveTableById, setActiveViewById, loadRecordsPage,
    createTable, updateTable, removeTable, createStandardTables,
    addField, editField, removeField,
    addRecord, editRecord, removeRecord,
    addView, editView, removeView,
    reorderTables, reorderViews,
    refreshTables,
    updateMagicTableConfig, syncMagicTable, searchSemantic,
    enrichRecordWithAI, checkForDuplicates, suppressDuplicate,
  ]);

  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export function useDatabase() {
  const ctx = useContext(DatabaseContext);
  if (!ctx) throw new Error('useDatabase must be used inside DatabaseProvider');
  return ctx;
}
