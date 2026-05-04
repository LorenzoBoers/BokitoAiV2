import { useState, useMemo } from 'react'
import { Filter, ArrowUpDown, Eye, Group, MoreHorizontal, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '../ui/dropdown-menu'
import { useDatabase } from '../../context/DatabaseContext'
import FilterBuilder from './filters/FilterBuilder'
import SortBuilder from './SortBuilder'
import GroupBySelector from './GroupBySelector'
import type { FilterGroup, SortCriteria, GroupByConfig, GridViewConfig } from '../../types/custom-db'

interface DatabaseToolbarProps {
  onRowHeightChange?: (height: 'compact' | 'standard' | 'tall') => void
  currentRowHeight?: 'compact' | 'standard' | 'tall'
}

export default function DatabaseToolbar({ onRowHeightChange, currentRowHeight = 'standard' }: DatabaseToolbarProps) {
  const { fields, activeView, editView } = useDatabase()
  const [showFilterBuilder, setShowFilterBuilder] = useState(false)
  const [showSortBuilder, setShowSortBuilder] = useState(false)
  const [showGroupSelector, setShowGroupSelector] = useState(false)

  const gridConfig = activeView?.view_type === 'grid' ? (activeView.config as GridViewConfig) : {}
  const filters = gridConfig.filters
  const sorts = gridConfig.sort ?? []
  const hiddenFields = gridConfig.hiddenFields ?? []
  const groupBy = gridConfig.groupBy

  // Count active filters
  const activeFilterCount = useMemo(() => {
    if (!filters) return 0
    const countFilters = (group: FilterGroup): number => {
      return group.rules.length + group.groups.reduce((sum, g) => sum + countFilters(g), 0)
    }
    return countFilters(filters)
  }, [filters])

  const handleFiltersChange = async (newFilters: FilterGroup | null) => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        filters: newFilters
      }
    })
  }

  const handleSortChange = async (newSort: SortCriteria[]) => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        sort: newSort
      }
    })
  }

  const handleGroupByChange = async (newGroupBy: GroupByConfig | null) => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        groupBy: newGroupBy
      }
    })
  }

  const handleFieldVisibilityChange = async (fieldSlug: string, visible: boolean) => {
    if (!activeView || activeView.view_type !== 'grid') return
    const newHiddenFields = visible 
      ? hiddenFields.filter(slug => slug !== fieldSlug)
      : [...hiddenFields, fieldSlug]
    
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        hiddenFields: newHiddenFields
      }
    })
  }

  const handleShowAllFields = async () => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        hiddenFields: []
      }
    })
  }

  const handleHideAllFields = async () => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        hiddenFields: fields.map(f => f.slug)
      }
    })
  }

  const handleRowHeightChange = async (height: 'compact' | 'standard' | 'tall') => {
    if (!activeView || activeView.view_type !== 'grid') return
    await editView(activeView.id, {
      config: {
        ...gridConfig,
        rowHeight: height
      }
    })
    onRowHeightChange?.(height)
  }

  const clearAllFilters = async () => {
    await handleFiltersChange(null)
  }

  const clearAllSorts = async () => {
    await handleSortChange([])
  }

  const clearGroupBy = async () => {
    await handleGroupByChange(null)
  }

  if (activeView?.view_type !== 'grid') {
    return null
  }

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-bg-sidebar/30">
        <div className="flex items-center gap-2">
          {/* Filter Button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowFilterBuilder(true)}
            className="h-8 gap-1.5 relative"
          >
            <Filter size={14} />
            Filter
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>

          {/* Sort Button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowSortBuilder(true)}
            className="h-8 gap-1.5"
          >
            <ArrowUpDown size={14} />
            Sort
            {sorts.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {sorts.length}
              </Badge>
            )}
          </Button>

          {/* Group Button */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowGroupSelector(true)}
            className="h-8 gap-1.5"
          >
            <Group size={14} />
            Group
            {groupBy && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                1
              </Badge>
            )}
          </Button>

          {/* Fields Button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5">
                <Eye size={14} />
                Fields
                {hiddenFields.length > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {fields.length - hiddenFields.length}/{fields.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <div className="flex items-center justify-between px-2 py-1.5">
                <span className="text-xs font-medium text-text-secondary">Field visibility</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={handleShowAllFields} className="h-6 px-2 text-[10px]">
                    Show all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleHideAllFields} className="h-6 px-2 text-[10px]">
                    Hide all
                  </Button>
                </div>
              </div>
              <DropdownMenuSeparator />
              {fields.map(field => (
                <DropdownMenuCheckboxItem
                  key={field.id}
                  checked={!hiddenFields.includes(field.slug)}
                  onCheckedChange={(checked) => handleFieldVisibilityChange(field.slug, checked)}
                >
                  {field.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          {/* Active filters/sorts/groups display */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-1">
              <Badge variant="outline" className="h-6 text-[10px] gap-1">
                {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}
                <button
                  onClick={clearAllFilters}
                  className="ml-1 hover:bg-bg-hover rounded-sm p-0.5"
                >
                  <X size={8} />
                </button>
              </Badge>
            </div>
          )}

          {sorts.length > 0 && (
            <Badge variant="outline" className="h-6 text-[10px] gap-1">
              {sorts.length} sort{sorts.length !== 1 ? 's' : ''}
              <button
                onClick={clearAllSorts}
                className="ml-1 hover:bg-bg-hover rounded-sm p-0.5"
              >
                <X size={8} />
              </button>
            </Badge>
          )}

          {groupBy && (
            <Badge variant="outline" className="h-6 text-[10px] gap-1">
              Grouped by {fields.find(f => f.slug === groupBy.fieldSlug)?.name}
              <button
                onClick={clearGroupBy}
                className="ml-1 hover:bg-bg-hover rounded-sm p-0.5"
              >
                <X size={8} />
              </button>
            </Badge>
          )}

          {/* Row height toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5">
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <div className="px-2 py-1.5 text-xs font-medium text-text-secondary">Row height</div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleRowHeightChange('compact')}
                className={currentRowHeight === 'compact' ? 'bg-accent/10' : ''}
              >
                Compact (32px)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRowHeightChange('standard')}
                className={currentRowHeight === 'standard' ? 'bg-accent/10' : ''}
              >
                Standard (48px)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleRowHeightChange('tall')}
                className={currentRowHeight === 'tall' ? 'bg-accent/10' : ''}
              >
                Tall (88px)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Filter Builder Modal */}
      {showFilterBuilder && (
        <FilterBuilder
          filters={filters ?? null}
          fields={fields}
          onChange={handleFiltersChange}
          onClose={() => setShowFilterBuilder(false)}
        />
      )}

      {/* Sort Builder Modal */}
      {showSortBuilder && (
        <SortBuilder
          sorts={sorts}
          fields={fields}
          onChange={handleSortChange}
          onClose={() => setShowSortBuilder(false)}
        />
      )}

      {/* Group By Selector Modal */}
      {showGroupSelector && (
        <GroupBySelector
          groupBy={groupBy ?? null}
          fields={fields}
          onChange={handleGroupByChange}
          onClose={() => setShowGroupSelector(false)}
        />
      )}
    </>
  )
}