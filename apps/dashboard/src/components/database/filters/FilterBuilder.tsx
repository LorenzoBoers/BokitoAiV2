import { useState, useCallback, useMemo } from 'react'
import { Plus, X, Trash2 } from 'lucide-react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card'
import type { FilterGroup, FilterRule, FilterOperator, CustomField, FieldType } from '../../../types/custom-db'

interface FilterBuilderProps {
  filters: FilterGroup | null
  fields: CustomField[]
  onChange: (filters: FilterGroup | null) => void
  onClose: () => void
}

// Operator definitions by field type
const OPERATORS_BY_TYPE: Record<FieldType, { value: FilterOperator; label: string }[]> = {
  text: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  number: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'between', label: 'between' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  currency: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'between', label: 'between' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  rating: [
    { value: 'eq', label: '=' },
    { value: 'neq', label: '≠' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'gte', label: '≥' },
    { value: 'lte', label: '≤' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  boolean: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
  ],
  date: [
    { value: 'date_is', label: 'is' },
    { value: 'date_before', label: 'before' },
    { value: 'date_after', label: 'after' },
    { value: 'date_within', label: 'within' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  email: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  url: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  phone: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'starts_with', label: 'starts with' },
    { value: 'ends_with', label: 'ends with' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  select: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'is_one_of', label: 'is one of' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  multi_select: [
    { value: 'is_one_of', label: 'contains any of' },
    { value: 'is_all_of', label: 'contains all of' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  relation: [
    { value: 'contains_record', label: 'contains record' },
    { value: 'contains_no_record', label: 'contains no record' },
  ],
  file: [
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
  formula: [
    { value: 'is', label: 'is' },
    { value: 'is_not', label: 'is not' },
    { value: 'contains', label: 'contains' },
    { value: 'is_empty', label: 'is empty' },
    { value: 'is_not_empty', label: 'is not empty' },
  ],
}

const DATE_WITHIN_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
]

function generateId(): string {
  return Math.random().toString(36).substr(2, 9)
}

export default function FilterBuilder({ filters, fields, onChange, onClose }: FilterBuilderProps) {
  const [localFilters, setLocalFilters] = useState<FilterGroup>(() => 
    filters ?? {
      id: generateId(),
      logicalOperator: 'AND',
      rules: [],
      groups: []
    }
  )

  const handleSave = useCallback(() => {
    // Clean up empty groups and rules
    const cleanFilters = cleanupFilterGroup(localFilters)
    onChange(cleanFilters.rules.length === 0 && cleanFilters.groups.length === 0 ? null : cleanFilters)
    onClose()
  }, [localFilters, onChange, onClose])

  const handleClearAll = useCallback(() => {
    onChange(null)
    onClose()
  }, [onChange, onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl max-h-[85vh] overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Filters</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          <FilterGroupComponent
            group={localFilters}
            fields={fields}
            onChange={setLocalFilters}
            level={0}
          />
          
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button variant="ghost" onClick={handleClearAll}>
              Clear all filters
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                Apply filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

interface FilterGroupComponentProps {
  group: FilterGroup
  fields: CustomField[]
  onChange: (group: FilterGroup) => void
  level: number
  onRemove?: () => void
}

function FilterGroupComponent({ group, fields, onChange, level, onRemove }: FilterGroupComponentProps) {
  const canNest = level < 2 // Max 3 levels (0, 1, 2)

  const updateGroup = useCallback((updates: Partial<FilterGroup>) => {
    onChange({ ...group, ...updates })
  }, [group, onChange])

  const addRule = useCallback(() => {
    const newRule: FilterRule = {
      id: generateId(),
      fieldSlug: fields[0]?.slug ?? '',
      operator: 'is',
      value: '',
      logicalOperator: 'AND'
    }
    updateGroup({ rules: [...group.rules, newRule] })
  }, [group.rules, updateGroup, fields])

  const addGroup = useCallback(() => {
    const newGroup: FilterGroup = {
      id: generateId(),
      logicalOperator: 'AND',
      rules: [],
      groups: []
    }
    updateGroup({ groups: [...group.groups, newGroup] })
  }, [group.groups, updateGroup])

  const updateRule = useCallback((ruleId: string, updates: Partial<FilterRule>) => {
    updateGroup({
      rules: group.rules.map(rule => 
        rule.id === ruleId ? { ...rule, ...updates } : rule
      )
    })
  }, [group.rules, updateGroup])

  const removeRule = useCallback((ruleId: string) => {
    updateGroup({ rules: group.rules.filter(rule => rule.id !== ruleId) })
  }, [group.rules, updateGroup])

  const updateNestedGroup = useCallback((groupId: string, updates: FilterGroup) => {
    updateGroup({
      groups: group.groups.map(g => g.id === groupId ? updates : g)
    })
  }, [group.groups, updateGroup])

  const removeNestedGroup = useCallback((groupId: string) => {
    updateGroup({ groups: group.groups.filter(g => g.id !== groupId) })
  }, [group.groups, updateGroup])

  const hasContent = group.rules.length > 0 || group.groups.length > 0

  return (
    <div className={`space-y-3 ${level > 0 ? 'border border-border rounded-lg p-3 bg-bg-sidebar/20' : ''}`}>
      {level > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Group:</span>
            <Select 
              value={group.logicalOperator} 
              onValueChange={(value: 'AND' | 'OR') => updateGroup({ logicalOperator: value })}
            >
              <SelectTrigger className="w-20 h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AND">AND</SelectItem>
                <SelectItem value="OR">OR</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      )}

      {hasContent && level === 0 && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-text-muted">Where:</span>
          <Select 
            value={group.logicalOperator} 
            onValueChange={(value: 'AND' | 'OR') => updateGroup({ logicalOperator: value })}
          >
            <SelectTrigger className="w-20 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">AND</SelectItem>
              <SelectItem value="OR">OR</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {group.rules.map((rule, index) => (
        <div key={rule.id} className="flex items-center gap-2">
          {index > 0 && (
            <span className="text-xs text-text-muted w-12 text-center">
              {rule.logicalOperator}
            </span>
          )}
          <FilterRuleComponent
            rule={rule}
            fields={fields}
            onChange={(updates) => updateRule(rule.id, updates)}
            onRemove={() => removeRule(rule.id)}
            showLogicalOperator={index > 0}
          />
        </div>
      ))}

      {group.groups.map((nestedGroup, index) => (
        <div key={nestedGroup.id} className="space-y-2">
          {(index > 0 || group.rules.length > 0) && (
            <div className="text-xs text-text-muted text-center">
              {nestedGroup.logicalOperator}
            </div>
          )}
          <FilterGroupComponent
            group={nestedGroup}
            fields={fields}
            onChange={(updates) => updateNestedGroup(nestedGroup.id, updates)}
            level={level + 1}
            onRemove={() => removeNestedGroup(nestedGroup.id)}
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={addRule}>
          <Plus size={12} className="mr-1" />
          Add rule
        </Button>
        {canNest && (
          <Button size="sm" variant="ghost" onClick={addGroup}>
            <Plus size={12} className="mr-1" />
            Add group
          </Button>
        )}
      </div>
    </div>
  )
}

interface FilterRuleComponentProps {
  rule: FilterRule
  fields: CustomField[]
  onChange: (updates: Partial<FilterRule>) => void
  onRemove: () => void
  showLogicalOperator: boolean
}

function FilterRuleComponent({ rule, fields, onChange, onRemove, showLogicalOperator }: FilterRuleComponentProps) {
  const field = fields.find(f => f.slug === rule.fieldSlug)
  const operators = field ? OPERATORS_BY_TYPE[field.field_type] ?? [] : []
  
  const needsValue = !['is_empty', 'is_not_empty', 'contains_no_record'].includes(rule.operator)

  return (
    <div className="flex items-center gap-2 flex-1">
      {showLogicalOperator && (
        <Select 
          value={rule.logicalOperator} 
          onValueChange={(value: 'AND' | 'OR') => onChange({ logicalOperator: value })}
        >
          <SelectTrigger className="w-16 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">AND</SelectItem>
            <SelectItem value="OR">OR</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Select value={rule.fieldSlug} onValueChange={(fieldSlug) => onChange({ fieldSlug, operator: 'is', value: '' })}>
        <SelectTrigger className="w-40 h-8 text-xs">
          <SelectValue placeholder="Select field" />
        </SelectTrigger>
        <SelectContent>
          {fields.map(field => (
            <SelectItem key={field.id} value={field.slug}>
              {field.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={rule.operator} onValueChange={(operator: FilterOperator) => onChange({ operator })}>
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map(op => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue && (
        <FilterValueInput
          field={field}
          operator={rule.operator}
          value={rule.value}
          onChange={(value) => onChange({ value })}
        />
      )}

      <Button size="sm" variant="ghost" onClick={onRemove}>
        <X size={12} />
      </Button>
    </div>
  )
}

interface FilterValueInputProps {
  field?: CustomField
  operator: FilterOperator
  value: unknown
  onChange: (value: unknown) => void
}

function FilterValueInput({ field, operator, value, onChange }: FilterValueInputProps) {
  if (!field) return null

  // Date within special case
  if (operator === 'date_within') {
    return (
      <Select 
        value={typeof value === 'string' ? value : 'today'} 
        onValueChange={onChange}
      >
        <SelectTrigger className="w-32 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_WITHIN_OPTIONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // Boolean field
  if (field.field_type === 'boolean') {
    return (
      <Select 
        value={value === true ? 'true' : 'false'} 
        onValueChange={(val) => onChange(val === 'true')}
      >
        <SelectTrigger className="w-24 h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">True</SelectItem>
          <SelectItem value="false">False</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  // Select field
  if (field.field_type === 'select' && field.config?.options) {
    return (
      <Select 
        value={typeof value === 'string' ? value : ''} 
        onValueChange={onChange}
      >
        <SelectTrigger className="w-40 h-8 text-xs">
          <SelectValue placeholder="Select option" />
        </SelectTrigger>
        <SelectContent>
          {field.config.options.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // Number fields
  if (['number', 'currency', 'rating'].includes(field.field_type)) {
    if (operator === 'between') {
      const [min, max] = Array.isArray(value) ? value : [null, null]
      return (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={min ?? ''}
            onChange={(e) => onChange([e.target.value === '' ? null : Number(e.target.value), max])}
            className="w-20 h-8 text-xs"
            placeholder="Min"
          />
          <span className="text-xs text-text-muted">and</span>
          <Input
            type="number"
            value={max ?? ''}
            onChange={(e) => onChange([min, e.target.value === '' ? null : Number(e.target.value)])}
            className="w-20 h-8 text-xs"
            placeholder="Max"
          />
        </div>
      )
    }
    return (
      <Input
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className="w-32 h-8 text-xs"
      />
    )
  }

  // Date field
  if (field.field_type === 'date') {
    return (
      <Input
        type="date"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-40 h-8 text-xs"
      />
    )
  }

  // Default text input
  return (
    <Input
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-40 h-8 text-xs"
      placeholder="Enter value"
    />
  )
}

function cleanupFilterGroup(group: FilterGroup): FilterGroup {
  const cleanRules = group.rules.filter(rule => 
    rule.fieldSlug && (
      !['is_empty', 'is_not_empty', 'contains_no_record'].includes(rule.operator) 
        ? rule.value !== '' && rule.value !== null && rule.value !== undefined
        : true
    )
  )
  
  const cleanGroups = group.groups
    .map(cleanupFilterGroup)
    .filter(g => g.rules.length > 0 || g.groups.length > 0)
  
  return {
    ...group,
    rules: cleanRules,
    groups: cleanGroups
  }
}