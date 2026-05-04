import { XANO_BASE_URL, TOKEN_KEY } from './xano';
import type {
  CustomTable, CustomField, CustomRecord, CustomView,
  FieldType, FieldConfig, ViewType, ViewConfig, PaginatedResponse,
  ActivityLogEntry, RecordComment, BulkAction,
} from '../types/custom-db';

const API_BASE = `${XANO_BASE_URL}/api:vLUpKLJh`;

/** After a 404 on standard-tables routes, skip further HTTP calls for this tab (StrictMode + navigation). Clear via sessionStorage.removeItem(...) to retry after backend deploy. */
const STANDARD_TABLES_UNAVAILABLE_KEY = 'bokito_standard_tables_api_unavailable';

function markStandardTablesApiUnavailable(): void {
  try {
    sessionStorage.setItem(STANDARD_TABLES_UNAVAILABLE_KEY, '1');
  } catch {
    /* ignore */
  }
}

function isStandardTablesApiUnavailable(): boolean {
  try {
    return sessionStorage.getItem(STANDARD_TABLES_UNAVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

function isMissingStandardTablesRouteError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('404') ||
    msg.includes('unable to locate') ||
    msg.includes('not found') ||
    msg.includes('locate request')
  );
}

function getToken(): string {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) throw new Error('Not authenticated');
  return token;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getToken()}`,
  };
  const init: RequestInit = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    // Handle rate limiting specifically
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const retrySeconds = retryAfter ? parseInt(retryAfter) : 60;
      
      // Import toast dynamically to avoid circular dependencies
      import('sonner').then(({ toast }) => {
        toast.error(`Rate limit bereikt - probeer over ${retrySeconds}s opnieuw`);
      });
    }
    
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    throw new Error(err.message || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Tables ──────────────────────────────────────────────

export function listTables(): Promise<CustomTable[]> {
  return request('GET', '/custom-tables');
}

export function createTable(data: {
  name: string; description?: string; icon?: string; color?: string;
}): Promise<CustomTable> {
  return request('POST', '/custom-tables', data);
}

export function updateTable(id: number, data: {
  name?: string; description?: string; icon?: string; color?: string;
}): Promise<CustomTable> {
  return request('PATCH', `/custom-tables/${id}`, data);
}

export function deleteTable(id: number): Promise<{ success: boolean }> {
  return request('DELETE', `/custom-tables/${id}`);
}

// ── Fields ──────────────────────────────────────────────

export function listFields(tableId: number): Promise<CustomField[]> {
  return request('GET', `/custom-tables/${tableId}/fields`);
}

export function createField(tableId: number, data: {
  name: string; field_type: FieldType; config?: FieldConfig; required?: boolean; default_value?: DefaultValue;
}): Promise<CustomField> {
  return request('POST', `/custom-tables/${tableId}/fields`, data);
}

export function updateField(fieldId: number, data: {
  name?: string; config?: FieldConfig; required?: boolean; position?: number; default_value?: DefaultValue;
}): Promise<CustomField> {
  return request('PATCH', `/custom-fields/${fieldId}`, data);
}

export function deleteField(fieldId: number): Promise<{ success: boolean }> {
  return request('DELETE', `/custom-fields/${fieldId}`);
}

// ── Records ─────────────────────────────────────────────

export function listRecords(
  tableId: number, page = 1, perPage = 50, includeDeleted = false,
): Promise<PaginatedResponse<CustomRecord>> {
  const params = new URLSearchParams({
    page: page.toString(),
    per_page: perPage.toString(),
    include_deleted: includeDeleted.toString(),
  });
  return request('GET', `/custom-tables/${tableId}/records?${params}`);
}

export function getRecord(recordId: number): Promise<CustomRecord> {
  return request('GET', `/custom-records/${recordId}`);
}

export function createRecord(
  tableId: number, data: Record<string, unknown>,
): Promise<CustomRecord> {
  return request('POST', `/custom-tables/${tableId}/records`, { data });
}

export function updateRecord(
  recordId: number, data: Record<string, unknown>,
): Promise<CustomRecord> {
  return request('PATCH', `/custom-records/${recordId}`, { data });
}

export function deleteRecord(recordId: number): Promise<{ success: boolean }> {
  return request('DELETE', `/custom-records/${recordId}`);
}

export function softDeleteRecord(recordId: number): Promise<CustomRecord> {
  return request('PATCH', `/custom-records/${recordId}/soft-delete`);
}

export function restoreRecord(recordId: number): Promise<CustomRecord> {
  return request('PATCH', `/custom-records/${recordId}/restore`);
}

export function duplicateRecord(
  recordId: number, 
  options: { includeRelations?: string[] } = {}
): Promise<CustomRecord> {
  return request('POST', `/custom-records/${recordId}/duplicate`, options);
}

export function bulkUpdateRecords(
  recordIds: number[], 
  data: Record<string, unknown>
): Promise<{ success: boolean; updated: number }> {
  return request('PATCH', `/custom-records/bulk`, { record_ids: recordIds, data });
}

export function bulkSoftDeleteRecords(recordIds: number[]): Promise<{ success: boolean; deleted: number }> {
  return request('PATCH', `/custom-records/bulk-soft-delete`, { record_ids: recordIds });
}

export function bulkRestoreRecords(recordIds: number[]): Promise<{ success: boolean; restored: number }> {
  return request('PATCH', `/custom-records/bulk-restore`, { record_ids: recordIds });
}

export function searchRecords(
  tableId: number, 
  query: string, 
  page = 1, 
  perPage = 50
): Promise<PaginatedResponse<CustomRecord>> {
  const params = new URLSearchParams({
    q: query,
    page: page.toString(),
    per_page: perPage.toString(),
  });
  return request('GET', `/custom-tables/${tableId}/search?${params}`);
}

// ── Activity & Comments ─────────────────────────────────

export function getRecordActivity(recordId: number): Promise<ActivityLogEntry[]> {
  return request('GET', `/custom-records/${recordId}/activity`);
}

export function getRecordComments(recordId: number): Promise<RecordComment[]> {
  return request('GET', `/custom-records/${recordId}/comments`);
}

// ── Views ───────────────────────────────────────────────

export function listViews(tableId: number): Promise<CustomView[]> {
  return request('GET', `/custom-tables/${tableId}/views`);
}

export function createView(tableId: number, data: {
  name: string; view_type: ViewType; config?: ViewConfig;
}): Promise<CustomView> {
  return request('POST', `/custom-tables/${tableId}/views`, data);
}

export function updateView(viewId: number, data: {
  name?: string; config?: ViewConfig;
}): Promise<CustomView> {
  return request('PATCH', `/custom-views/${viewId}`, data);
}

// ── Standard Tables ─────────────────────────────────────────

let listStandardTablesInFlight: Promise<CustomTable[]> | null = null;
let createStandardTablesInFlight: Promise<CustomTable[]> | null = null;

export function createStandardTables(): Promise<CustomTable[]> {
  if (isStandardTablesApiUnavailable()) {
    return Promise.resolve([]);
  }
  if (createStandardTablesInFlight) return createStandardTablesInFlight;
  createStandardTablesInFlight = request<CustomTable[]>('POST', '/standard-tables/create')
    .catch((err) => {
      if (isMissingStandardTablesRouteError(err)) {
        markStandardTablesApiUnavailable();
        return [];
      }
      throw err;
    })
    .finally(() => {
      createStandardTablesInFlight = null;
    });
  return createStandardTablesInFlight;
}

export function listStandardTables(): Promise<CustomTable[]> {
  if (isStandardTablesApiUnavailable()) {
    return Promise.resolve([]);
  }
  if (listStandardTablesInFlight) return listStandardTablesInFlight;
  listStandardTablesInFlight = request<CustomTable[]>('GET', '/standard-tables')
    .catch((err) => {
      if (isMissingStandardTablesRouteError(err)) {
        markStandardTablesApiUnavailable();
        return [];
      }
      throw err;
    })
    .finally(() => {
      listStandardTablesInFlight = null;
    });
  return listStandardTablesInFlight;
}

// ── Activity Log ────────────────────────────────────────────

export function listRecordActivity(recordId: number): Promise<any[]> {
  return request('GET', `/custom-records/${recordId}/activity`);
}

export function addRecordNote(recordId: number, note: string): Promise<any> {
  return request('POST', `/custom-records/${recordId}/activity`, { 
    action: 'note', 
    note 
  });
}

// ── Comments ────────────────────────────────────────────────

export function listRecordComments(recordId: number): Promise<any[]> {
  return request('GET', `/custom-records/${recordId}/comments`);
}

export function addRecordComment(recordId: number, data: {
  content: string; parent_id?: number; mentions?: number[];
}): Promise<any> {
  return request('POST', `/custom-records/${recordId}/comments`, data);
}

export function updateRecordComment(commentId: number, content: string): Promise<any> {
  return request('PATCH', `/record-comments/${commentId}`, { content });
}

export function deleteRecordComment(commentId: number): Promise<{ success: boolean }> {
  return request('DELETE', `/record-comments/${commentId}`);
}

// ── Users ───────────────────────────────────────────────────

export function listWorkspaceUsers(): Promise<any[]> {
  return request('GET', '/workspace-users');
}

// ── CSV Import ───────────────────────────────────────────

export function importCSV(tableId: number, file: File, mapping: Record<string, string>): Promise<{ imported: number; skipped: number; errors: Array<{ row: number; message: string }> }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mapping', JSON.stringify(mapping));
  return request('POST', `/custom-tables/${tableId}/import/csv`, formData as unknown as object);
}

// ── Data Export ──────────────────────────────────────────

export function exportData(tableId: number, format: 'csv' | 'json' | 'xlsx', fields?: string[]): Promise<Blob> {
  const params = new URLSearchParams({ format });
  if (fields?.length) params.set('fields', fields.join(','));
  return request('GET', `/custom-tables/${tableId}/export?${params}`);
}
