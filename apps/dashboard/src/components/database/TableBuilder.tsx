import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import FieldTypeSelector from './FieldTypeSelector';
import { 
  Plus, 
  GripVertical, 
  Edit2, 
  Trash2, 
  Check, 
  X,
  AlertCircle
} from 'lucide-react';
import { useDatabase } from '../../context/DatabaseContext';
import { useValidation } from '../../context/ValidationContext';
import { useUndoRedo } from '../../context/UndoRedoContext';
import type { CustomField, FieldType, FieldConfig } from '../../types/custom-db';
import { FIELD_TYPE_META } from '../../types/custom-db';
import { cn } from '../../lib/utils';

interface TableBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  tableId?: number;
}

interface FieldDraft {
  id?: number;
  name: string;
  field_type: FieldType;
  config: FieldConfig;
  required: boolean;
  position: number;
  isNew?: boolean;
  isEditing?: boolean;
}

export function TableBuilder({ isOpen, onClose, tableId }: TableBuilderProps) {
  const { fields, addField, editField, removeField } = useDatabase();
  const { validateField, getFieldError, clearErrors } = useValidation();
  const { addAction } = useUndoRedo();
  
  const [fieldDrafts, setFieldDrafts] = useState<FieldDraft[]>(() => 
    fields.map((f, i) => ({ ...f, position: i, isEditing: false }))
  );
  const [editingField, setEditingField] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const addNewField = () => {
    const newField: FieldDraft = {
      name: '',
      field_type: 'text',
      config: {},
      required: false,
      position: fieldDrafts.length,
      isNew: true,
      isEditing: true,
    };
    
    setFieldDrafts(prev => [...prev, newField]);
    setEditingField(`new-${fieldDrafts.length}`);
  };

  const saveField = async (index: number) => {
    const field = fieldDrafts[index];
    
    // Validate field name
    const isValid = validateField(`field-${index}`, field.name, [
      { type: 'required', message: 'Veldnaam is verplicht' },
      { type: 'minLength', value: 1, message: 'Veldnaam moet minimaal 1 karakter zijn' },
      {
        type: 'custom',
        message: 'Deze veldnaam bestaat al',
        validator: (value) => !fieldDrafts.some((f, i) => 
          i !== index && f.name.toLowerCase() === value.toLowerCase()
        ),
      },
    ]);

    if (!isValid) return;

    try {
      if (field.isNew) {
        const created = await addField({
          name: field.name,
          field_type: field.field_type,
          config: field.config,
          required: field.required,
        });
        
        addAction({
          type: 'create',
          entity: 'field',
          entityId: created.id,
          newData: created,
        });

        setFieldDrafts(prev => prev.map((f, i) => 
          i === index 
            ? { ...created, position: i, isEditing: false, isNew: false }
            : f
        ));
      } else if (field.id) {
        await editField(field.id, {
          name: field.name,
          config: field.config,
          required: field.required,
          position: field.position,
        });

        addAction({
          type: 'update',
          entity: 'field',
          entityId: field.id,
          previousData: fields.find(f => f.id === field.id),
          newData: field,
        });

        setFieldDrafts(prev => prev.map((f, i) => 
          i === index ? { ...f, isEditing: false } : f
        ));
      }
      
      setEditingField(null);
      clearErrors();
    } catch (error) {
      console.error('Failed to save field:', error);
    }
  };

  const cancelEdit = (index: number) => {
    const field = fieldDrafts[index];
    
    if (field.isNew) {
      setFieldDrafts(prev => prev.filter((_, i) => i !== index));
    } else {
      const original = fields.find(f => f.id === field.id);
      if (original) {
        setFieldDrafts(prev => prev.map((f, i) => 
          i === index 
            ? { ...original, position: i, isEditing: false }
            : f
        ));
      }
    }
    
    setEditingField(null);
    clearErrors();
  };

  const deleteField = async (index: number) => {
    const field = fieldDrafts[index];
    
    if (field.isNew) {
      setFieldDrafts(prev => prev.filter((_, i) => i !== index));
      return;
    }

    if (!field.id) return;

    if (confirm('Weet je zeker dat je dit veld wilt verwijderen?')) {
      try {
        await removeField(field.id);
        
        addAction({
          type: 'delete',
          entity: 'field',
          entityId: field.id,
          previousData: field,
        });

        setFieldDrafts(prev => prev.filter((_, i) => i !== index));
      } catch (error) {
        console.error('Failed to delete field:', error);
      }
    }
  };

  const startEdit = (index: number) => {
    setEditingField(`field-${index}`);
    setFieldDrafts(prev => prev.map((f, i) => 
      i === index ? { ...f, isEditing: true } : f
    ));
  };

  const updateField = (index: number, updates: Partial<FieldDraft>) => {
    setFieldDrafts(prev => prev.map((f, i) => 
      i === index ? { ...f, ...updates } : f
    ));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setFieldDrafts((items) => {
        const oldIndex = items.findIndex(item => 
          item.id ? `field-${item.id}` : `new-${items.indexOf(item)}` === active.id
        );
        const newIndex = items.findIndex(item => 
          item.id ? `field-${item.id}` : `new-${items.indexOf(item)}` === over.id
        );

        const newItems = arrayMove(items, oldIndex, newIndex);
        return newItems.map((item, index) => ({ ...item, position: index }));
      });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-bg-surface border border-border rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-heading">
            Tabel bouwen
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={fieldDrafts.map((f, i) => f.id ? `field-${f.id}` : `new-${i}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-3">
                {fieldDrafts.map((field, index) => (
                  <SortableFieldItem
                    key={field.id ? `field-${field.id}` : `new-${index}`}
                    id={field.id ? `field-${field.id}` : `new-${index}`}
                    field={field}
                    index={index}
                    isEditing={field.isEditing || false}
                    error={getFieldError(`field-${index}`)}
                    onSave={() => saveField(index)}
                    onCancel={() => cancelEdit(index)}
                    onEdit={() => startEdit(index)}
                    onDelete={() => deleteField(index)}
                    onUpdate={(updates) => updateField(index, updates)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>

          <Button
            onClick={addNewField}
            variant="ghost"
            className="w-full mt-4 h-12 border-2 border-dashed border-border hover:border-border-light"
          >
            <Plus size={16} />
            Veld toevoegen
          </Button>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Sluiten
          </Button>
        </div>
      </div>
    </div>
  );
}

interface SortableFieldItemProps {
  id: string;
  field: FieldDraft;
  index: number;
  isEditing: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<FieldDraft>) => void;
}

function SortableFieldItem({
  id,
  field,
  index,
  isEditing,
  error,
  onSave,
  onCancel,
  onEdit,
  onDelete,
  onUpdate,
}: SortableFieldItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const fieldTypeMeta = FIELD_TYPE_META[field.field_type];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'bg-bg-elevated border border-border rounded-lg transition-shadow',
        isDragging && 'shadow-lg',
        error && 'border-status-error'
      )}
    >
      {isEditing ? (
        <div className="p-4 space-y-4">
          <div className="flex items-start gap-3">
            <div
              {...attributes}
              {...listeners}
              className="mt-2 p-1 hover:bg-bg-hover rounded cursor-grab active:cursor-grabbing"
            >
              <GripVertical size={16} className="text-text-muted" />
            </div>
            
            <div className="flex-1 space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Veldnaam *
                </label>
                <Input
                  value={field.name}
                  onChange={(e) => onUpdate({ name: e.target.value })}
                  placeholder="Bijv. Naam, E-mail, Telefoon"
                  className={error ? 'border-status-error' : ''}
                />
                {error && (
                  <p className="text-status-error text-sm mt-1 flex items-center gap-1">
                    <AlertCircle size={14} />
                    {error}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">
                    Veldtype
                  </label>
                  <FieldTypeSelector
                    value={field.field_type}
                    onChange={(type) => onUpdate({ field_type: type })}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(e) => onUpdate({ required: e.target.checked })}
                      className="rounded border-border"
                    />
                    Verplicht veld
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>
              <X size={14} />
              Annuleren
            </Button>
            <Button size="sm" onClick={onSave}>
              <Check size={14} />
              Opslaan
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-center gap-3">
            <div
              {...attributes}
              {...listeners}
              className="p-1 hover:bg-bg-hover rounded cursor-grab active:cursor-grabbing"
            >
              <GripVertical size={16} className="text-text-muted" />
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-text-primary">
                  {field.name || 'Naamloos veld'}
                </span>
                {field.required && (
                  <Badge variant="destructive" className="text-xs">
                    Verplicht
                  </Badge>
                )}
              </div>
              <div className="text-sm text-text-secondary">
                {fieldTypeMeta.label} · {fieldTypeMeta.description}
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={onEdit}>
                <Edit2 size={14} />
              </Button>
              <Button variant="ghost" size="sm" onClick={onDelete}>
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TableBuilder;