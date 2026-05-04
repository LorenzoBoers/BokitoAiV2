export const FIELD_TYPES = [
  'text', 'number', 'boolean', 'date', 'datetime', 'email', 'url', 'phone',
  'select', 'multi_select', 'file', 'attachment', 'currency', 'rating',
  'relation', 'lookup', 'formula', 'long_text', 'json', 'created_at', 'updated_at',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const VIEW_TYPES = ['grid', 'kanban', 'calendar'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export interface SelectOption {
  value: string;
  label: string;
  color: string;
}

export interface FieldConfig {
  // Text field configs
  maxLength?: number;
  regex?: string;
  regexMessage?: string;
  unique?: boolean;
  
  // Number field configs
  decimals?: number;
  min?: number;
  max?: number;
  isInteger?: boolean;
  
  // Date field configs
  includeTime?: boolean;
  
  // Select field configs
  options?: SelectOption[];
  colorRamp?: string;
  
  // Attachment field configs
  accept?: string[];
  maxFileSize?: number; // in MB
  maxFiles?: number;
  
  // Currency field configs
  symbol?: string;
  
  // Relation field configs
  tableId?: number;
  displayField?: string;
  relationType?: 'one_to_many' | 'many_to_many';
  
  // Lookup field configs
  sourceTableId?: number;
  sourceFieldSlug?: string;
  relationFieldSlug?: string;
  
  // Formula field configs
  expression?: string;
  outputType?: 'text' | 'number' | 'boolean' | 'date';
}

export interface CustomTable {
  id: number;
  organisation_id: number;
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
  is_standard?: boolean;
  created_at: string;
  updated_at: string;
  magic_table_config?: MagicTableConfig;
}

export interface CustomField {
  id: number;
  custom_table_id: number;
  name: string;
  slug: string;
  field_type: FieldType;
  config: FieldConfig;
  required: boolean;
  position: number;
  default_value?: DefaultValue;
  created_at: string;
  is_system?: boolean;
}

export interface CustomRecord {
  id: number;
  custom_table_id: number;
  data: Record<string, unknown>;
  is_deleted: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  owner_id?: number;
}

export interface CustomView {
  id: number;
  custom_table_id: number;
  name: string;
  view_type: ViewType;
  config: ViewConfig;
  position: number;
  created_at: string;
}

export interface GridViewConfig {
  columnWidths?: Record<string, number>;
  hiddenFields?: string[];
  fieldOrder?: string[];
  sort?: SortCriteria[];
  filters?: FilterGroup;
  groupBy?: GroupByConfig;
  rowHeight?: 'compact' | 'standard' | 'tall';
}

export interface KanbanViewConfig {
  groupByFieldSlug?: string;
  cardTitleFieldSlug?: string;
  cardFields?: string[];
  collapsedColumns?: string[];
}

export interface CalendarViewConfig {
  dateFieldSlug?: string;
  titleFieldSlug?: string;
}

export type ViewConfig = GridViewConfig | KanbanViewConfig | CalendarViewConfig;

// Enhanced filter types
export interface FilterRule {
  id: string;
  fieldSlug: string;
  operator: FilterOperator;
  value: unknown;
  logicalOperator: 'AND' | 'OR';
}

export interface FilterGroup {
  id: string;
  logicalOperator: 'AND' | 'OR';
  rules: FilterRule[];
  groups: FilterGroup[];
}

export type FilterOperator = 
  // Text operators
  | 'is' | 'is_not' | 'contains' | 'starts_with' | 'ends_with' | 'is_empty' | 'is_not_empty'
  // Number operators  
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'
  // Date operators
  | 'date_is' | 'date_before' | 'date_after' | 'date_within'
  // Select operators
  | 'is_one_of' | 'is_all_of'
  // Relation operators
  | 'contains_record' | 'contains_no_record';

// Sort configuration
export interface SortCriteria {
  fieldSlug: string;
  direction: 'asc' | 'desc';
}

// Group by configuration
export interface GroupByConfig {
  fieldSlug: string;
  groupType?: 'day' | 'week' | 'month'; // For date fields
  collapsedGroups?: string[];
}

// Legacy filter for backward compatibility
export interface ViewFilter {
  fieldSlug: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'empty' | 'not_empty';
  value: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  curPage: number;
  nextPage: number | null;
  prevPage: number | null;
  itemsReceived: number;
  itemsTotal: number;
}

export interface ActivityLogEntry {
  id: number;
  record_id: number;
  user_id: number;
  user_name: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  field_changes?: { field_slug: string; field_name: string; old_value: unknown; new_value: unknown }[];
  created_at: string;
}

export interface RecordComment {
  id: number;
  record_id: number;
  user_id: number;
  user_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface BulkAction {
  type: 'delete' | 'restore' | 'update';
  field_slug?: string;
  value?: unknown;
}

export const FIELD_TYPE_META: Record<FieldType, { label: string; icon: string; description: string }> = {
  text:         { label: 'Tekst',        icon: 'Type',         description: 'Enkele regel tekst' },
  long_text:    { label: 'Lange tekst',  icon: 'AlignLeft',    description: 'Meerdere regels tekst' },
  number:       { label: 'Nummer',       icon: 'Hash',         description: 'Geheel getal of decimaal' },
  boolean:      { label: 'Checkbox',     icon: 'CheckSquare',  description: 'Aan/uit schakelaar' },
  date:         { label: 'Datum',        icon: 'Calendar',     description: 'Datum zonder tijd' },
  datetime:     { label: 'Datum & Tijd', icon: 'Clock',        description: 'Datum met tijd' },
  email:        { label: 'E-mail',       icon: 'Mail',         description: 'E-mailadres' },
  url:          { label: 'URL',          icon: 'Link',         description: 'Webadres' },
  phone:        { label: 'Telefoon',     icon: 'Phone',        description: 'Telefoonnummer' },
  select:       { label: 'Select',       icon: 'List',         description: 'Keuze uit opties' },
  multi_select: { label: 'Multi-select', icon: 'ListChecks',   description: 'Meerdere opties kiezen' },
  file:         { label: 'Bestand',      icon: 'File',         description: 'Bestand uploaden' },
  attachment:   { label: 'Bijlage',      icon: 'Paperclip',    description: 'Bestanden uploaden' },
  currency:     { label: 'Valuta',       icon: 'DollarSign',   description: 'Geldbedrag' },
  rating:       { label: 'Beoordeling',  icon: 'Star',         description: 'Sterren-beoordeling' },
  relation:     { label: 'Relatie',      icon: 'Link2',        description: 'Link naar andere tabel' },
  lookup:       { label: 'Opzoeken',     icon: 'Search',       description: 'Waarde uit gerelateerde tabel' },
  formula:      { label: 'Formule',      icon: 'Calculator',   description: 'Berekend veld' },
  json:         { label: 'JSON',         icon: 'Braces',       description: 'Gestructureerde data' },
  created_at:   { label: 'Aangemaakt op', icon: 'Calendar',    description: 'Automatische aanmaakdatum' },
  updated_at:   { label: 'Bijgewerkt op', icon: 'Clock',       description: 'Automatische wijzigingsdatum' },
};

// Role-based access control types
export const USER_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSION_ACTIONS = [
  'edit_record',
  'delete_record', 
  'create_table',
  'edit_schema',
  'manage_api_keys',
  'manage_webhooks',
  'delete_workspace',
  'invite_members',
  'view_audit_log'
] as const;
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

// Member management types
export interface WorkspaceMember {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  joinedAt: string;
  status: 'active' | 'invited' | 'suspended';
}

export interface PendingInvite {
  id: number;
  email: string;
  role: UserRole;
  invitedBy: string;
  invitedAt: string;
  expiresAt: string;
}

// Audit log types
export const AUDIT_ACTION_TYPES = [
  'record_create',
  'record_update', 
  'record_delete',
  'schema_change',
  'api_key_create',
  'api_key_revoke',
  'role_change',
  'login'
] as const;
export type AuditActionType = (typeof AUDIT_ACTION_TYPES)[number];

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  userId: number;
  userName: string;
  userAvatar?: string;
  actionType: AuditActionType;
  tableName?: string;
  recordId?: number;
  changedFields?: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
  details?: string;
}

// Notification types
export const NOTIFICATION_TYPES = [
  'mention',
  'assignment',
  'comment',
  'webhook_failure'
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  recordId?: number;
  tableName?: string;
  userId: number;
}

// Workspace settings types
export interface WorkspaceSettings {
  id: number;
  name: string;
  logo?: string;
  timezone: string;
  language: 'nl' | 'en';
  require2FA: boolean;
}

// Usage statistics types
export interface UsageStats {
  totalRecords: number;
  recordsByTable: Array<{
    tableName: string;
    count: number;
  }>;
  apiCallsLast30Days: number;
  apiCallsHistory: Array<{
    date: string;
    count: number;
  }>;
  storageUsedMB: number;
  webhookSuccessRate: number;
  planLimits: {
    maxRecords: number;
    maxApiCalls: number;
    maxStorageMB: number;
  };
}

// Default value for fields
export type DefaultValue = string | number | boolean | null | undefined;

// Validation error
export interface ValidationError {
  fieldSlug: string;
  message: string;
  type: 'required' | 'format' | 'range' | 'unique' | 'custom';
}

// AI enrichment
export interface AIEnrichmentSuggestion {
  fieldSlug: string;
  currentValue: unknown;
  suggestedValue: unknown;
  confidence: number;
  reasoning: string;
}

// CSV import types
export interface CSVImportConfig {
  tableId: number;
  delimiter?: string;
  hasHeader?: boolean;
  encoding?: string;
}

export interface ImportProgress {
  total: number;
  processed: number;
  errors: number;
  status: 'pending' | 'running' | 'done' | 'error';
}

export interface CSVImportMapping {
  csvColumn: string;
  fieldSlug: string | null;
  createNew?: boolean;
  newFieldName?: string;
  newFieldType?: FieldType;
}

export interface CSVImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

// Export types
export interface ExportConfig {
  tableId: number;
  format: 'csv' | 'json' | 'xlsx';
  fields?: string[];
  filters?: FilterGroup;
}

export interface ExportOptions {
  format: 'csv' | 'json' | 'xlsx';
  includeHeaders?: boolean;
  fields?: string[];
}

// Duplicate detection
export interface DuplicateDetection {
  recordId: number;
  duplicateIds: number[];
  confidence: number;
  matchedFields: string[];
  /** Xano / API snake_case (optional) */
  possible_duplicate_id?: number;
  possible_duplicate_name?: string;
  similarity_score?: number;
}

// Semantic search result
export interface SemanticSearchResult {
  record_id: number;
  score: number;
  highlights?: Record<string, string>;
}

// Magic table config
export interface MagicTableConfig {
  enabled?: boolean;
  vectorEnabled?: boolean;
  aiEnrichmentEnabled?: boolean;
  semanticSearchEnabled?: boolean;
  autoDeduplication?: boolean;
  embeddingFields?: string[];
}
