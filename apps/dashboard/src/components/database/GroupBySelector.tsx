import { useState, useCallback } from 'react'
import { X, Group } from 'lucide-react'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import type { GroupByConfig, CustomField } from '../../types/custom-db'

interface GroupBySelectorProps {
  groupBy: GroupByConfig | null
  fields: CustomField[]
  onChange: (groupBy: GroupByConfig | null) => void
  onClose: () => void
}

export default function GroupBySelector({ groupBy, fields, onChange, onClose }: GroupBySelectorProps) {
  const [localGroupBy, setLocalGroupBy] = useState<GroupByConfig | null>(groupBy)

  // Filter fields that can be used for grouping
  const groupableFields = fields.filter(field => 
    ['select', 'multi_select', 'boolean', 'date', 'relation'].includes(field.field_type)
  )

  const handleSave = useCallback(() => {
    onChange(localGroupBy)
    onClose()
  }, [localGroupBy, onChange, onClose])

  const handleClear = useCallback(() => {
    onChange(null)
    onClose()
  }, [onChange, onClose])

  const handleFieldChange = useCallback((fieldSlug: string) => {
    const field = fields.find(f => f.slug === fieldSlug)
    if (!field) return

    const newGroupBy: GroupByConfig = {
      fieldSlug,
      // Set default group type for date fields
      ...(field.field_type === 'date' && { groupType: 'day' }),
      collapsedGroups: []
    }
    setLocalGroupBy(newGroupBy)
  }, [fields])

  const handleGroupTypeChange = useCallback((groupType: 'day' | 'week' | 'month') => {
    if (!localGroupBy) return
    setLocalGroupBy({ ...localGroupBy, groupType })
  }, [localGroupBy])

  const selectedField = localGroupBy ? fields.find(f => f.slug === localGroupBy.fieldSlug) : null

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Group by</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {groupableFields.length === 0 ? (
            <div className="text-center py-8 text-text-muted">
              <Group size={24} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No groupable fields</p>
              <p className="text-xs">Add select, date, or relation fields to enable grouping</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-text-secondary mb-2 block">
                  Group by field
                </label>
                <Select 
                  value={localGroupBy?.fieldSlug ?? ''} 
                  onValueChange={handleFieldChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select field to group by" />
                  </SelectTrigger>
                  <SelectContent>
                    {groupableFields.map(field => (
                      <SelectItem key={field.id} value={field.slug}>
                        <div className="flex items-center gap-2">
                          {field.name}
                          <span className="text-xs text-text-muted">
                            ({field.field_type})
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedField?.field_type === 'date' && localGroupBy && (
                <div>
                  <label className="text-xs font-medium text-text-secondary mb-2 block">
                    Group dates by
                  </label>
                  <Select 
                    value={localGroupBy.groupType ?? 'day'} 
                    onValueChange={handleGroupTypeChange}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {localGroupBy && (
                <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg">
                  <div className="text-xs text-text-secondary mb-1">Preview</div>
                  <div className="text-sm">
                    Records will be grouped by <strong>{selectedField?.name}</strong>
                    {selectedField?.field_type === 'date' && localGroupBy.groupType && (
                      <span> ({localGroupBy.groupType})</span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    Groups are collapsible and show record counts
                  </div>
                </div>
              )}
            </div>
          )}
          
          <div className="flex justify-between items-center pt-4 border-t border-border">
            <Button variant="ghost" onClick={handleClear}>
              Clear grouping
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!localGroupBy}>
                Apply grouping
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}