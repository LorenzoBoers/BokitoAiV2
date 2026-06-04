import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listInboxMembers, type InboxMember } from '../../lib/inbox-api';
import { 
  Plus, 
  Edit, 
  Trash2, 
  GripVertical, 
  Save, 
  X, 
  Info,
  User,
  Tag
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { 
  RoutingRule, 
  RoutingConditionType, 
  CreateRoutingRuleRequest,
  UpdateRoutingRuleRequest 
} from '../../types/inbox';
import { ROUTING_CONDITION_LABELS } from '../../types/inbox';

// Mock labels
const availableLabels = [
  'urgent', 'support', 'sales', 'billing', 'general', 'follow-up', 'vip'
];

interface RoutingRulesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxId: number;
  mailboxEmail: string;
  rules: RoutingRule[];
  onSaveRules: (rules: RoutingRule[]) => void;
}

interface RuleFormData {
  condition_type: RoutingConditionType;
  condition_value: string;
  assign_to_user_id: number | null;
  labels: string[];
  active: boolean;
}

const defaultRuleForm: RuleFormData = {
  condition_type: 'sender_domain',
  condition_value: '',
  assign_to_user_id: null,
  labels: [],
  active: true
};

export default function RoutingRulesManager({ 
  open, 
  onOpenChange, 
  mailboxId, 
  mailboxEmail, 
  rules, 
  onSaveRules 
}: RoutingRulesManagerProps) {
  const { token } = useAuth();
  const [assignableUsers, setAssignableUsers] = useState<InboxMember[]>([]);
  const [localRules, setLocalRules] = useState<RoutingRule[]>(rules);
  const [editingRule, setEditingRule] = useState<RoutingRule | null>(null);
  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [ruleForm, setRuleForm] = useState<RuleFormData>(defaultRuleForm);

  useEffect(() => {
    if (!open || !token) return;
    let cancelled = false;
    void listInboxMembers(token)
      .then((rows) => {
        if (!cancelled) setAssignableUsers(rows);
      })
      .catch(() => {
        if (!cancelled) setAssignableUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, token]);

  const handleAddRule = useCallback(() => {
    setEditingRule(null);
    setRuleForm(defaultRuleForm);
    setRuleFormOpen(true);
  }, []);

  const handleEditRule = useCallback((rule: RoutingRule) => {
    setEditingRule(rule);
    setRuleForm({
      condition_type: rule.condition_type,
      condition_value: rule.condition_value,
      assign_to_user_id: rule.assign_to_user_id,
      labels: rule.labels,
      active: rule.active
    });
    setRuleFormOpen(true);
  }, []);

  const handleDeleteRule = useCallback((ruleId: number) => {
    setLocalRules(prev => prev.filter(r => r.id !== ruleId));
  }, []);

  const handleToggleRule = useCallback((ruleId: number) => {
    setLocalRules(prev => prev.map(r => 
      r.id === ruleId ? { ...r, active: !r.active } : r
    ));
  }, []);

  const handleSaveRule = useCallback(() => {
    if (!ruleForm.condition_value.trim()) return;

    if (editingRule) {
      // Update existing rule
      setLocalRules(prev => prev.map(r => 
        r.id === editingRule.id 
          ? { 
              ...r, 
              ...ruleForm,
              updated_at: new Date().toISOString()
            }
          : r
      ));
    } else {
      // Create new rule
      const newRule: RoutingRule = {
        id: Date.now(),
        mailbox_connection_id: mailboxId,
        ...ruleForm,
        priority: localRules.length + 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      setLocalRules(prev => [...prev, newRule]);
    }

    setRuleFormOpen(false);
    setEditingRule(null);
  }, [ruleForm, editingRule, mailboxId, localRules.length]);

  const handleMoveRule = useCallback((ruleId: number, direction: 'up' | 'down') => {
    setLocalRules(prev => {
      const sorted = [...prev].sort((a, b) => a.priority - b.priority);
      const index = sorted.findIndex(r => r.id === ruleId);
      
      if (
        (direction === 'up' && index === 0) ||
        (direction === 'down' && index === sorted.length - 1)
      ) {
        return prev;
      }

      const newIndex = direction === 'up' ? index - 1 : index + 1;
      [sorted[index], sorted[newIndex]] = [sorted[newIndex], sorted[index]];
      
      return sorted.map((rule, i) => ({ ...rule, priority: i + 1 }));
    });
  }, []);

  const handleSaveAll = useCallback(() => {
    onSaveRules(localRules);
    onOpenChange(false);
  }, [localRules, onSaveRules, onOpenChange]);

  const handleLabelToggle = useCallback((label: string) => {
    setRuleForm(prev => ({
      ...prev,
      labels: prev.labels.includes(label)
        ? prev.labels.filter(l => l !== label)
        : [...prev.labels, label]
    }));
  }, []);

  const sortedRules = [...localRules].sort((a, b) => a.priority - b.priority);

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[900px] max-w-[95vw] max-h-[90vh] bg-bg-surface border border-border rounded-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <Dialog.Title className="text-lg font-semibold text-text-heading">
                Routing regels - {mailboxEmail}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon">
                  <X size={16} />
                </Button>
              </Dialog.Close>
            </div>

            <div className="p-4 space-y-4 max-h-[calc(90vh-160px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-text-heading">Routing regels</h3>
                  <p className="text-sm text-text-secondary">
                    Bepaal hoe inkomende e-mails worden toegewezen en gelabeld
                  </p>
                </div>
                <Button onClick={handleAddRule}>
                  <Plus size={16} />
                  Regel toevoegen
                </Button>
              </div>

              <div className="bg-bg-elevated p-3 rounded-md flex items-start gap-2">
                <Info size={16} className="text-accent mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-text-heading mb-1">Hoe werken routing regels?</p>
                  <p className="text-text-secondary">
                    Regels worden van boven naar beneden uitgevoerd. De <strong>eerste match wint</strong>.
                    Sleep regels om de volgorde te wijzigen.
                  </p>
                </div>
              </div>

              {sortedRules.length === 0 ? (
                <div className="text-center py-8 text-text-muted">
                  <Tag size={32} className="mx-auto mb-2 opacity-50" />
                  <p>Nog geen routing regels geconfigureerd</p>
                  <p className="text-sm">Voeg je eerste regel toe om e-mails automatisch te routeren</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>Conditie</TableHead>
                      <TableHead>Waarde</TableHead>
                      <TableHead>Toegewezen aan</TableHead>
                      <TableHead>Labels</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-24">Acties</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRules.map((rule, index) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleMoveRule(rule.id, 'up')}
                              disabled={index === 0}
                            >
                              <GripVertical size={12} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => handleMoveRule(rule.id, 'down')}
                              disabled={index === sortedRules.length - 1}
                            >
                              <GripVertical size={12} />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="neutral">
                            {ROUTING_CONDITION_LABELS[rule.condition_type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {rule.condition_value}
                        </TableCell>
                        <TableCell>
                          {rule.assign_to_user_id ? (
                            <div className="flex items-center gap-1">
                              <User size={12} />
                              {assignableUsers.find(u => u.id === rule.assign_to_user_id)?.name || 'Unknown'}
                            </div>
                          ) : (
                            <span className="text-text-muted">Niet toegewezen</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {rule.labels.map(label => (
                              <Badge key={label} variant="accent" className="text-xs">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => handleToggleRule(rule.id)}
                            className="text-left"
                          >
                            <Badge variant={rule.active ? 'success' : 'neutral'}>
                              {rule.active ? 'Actief' : 'Inactief'}
                            </Badge>
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEditRule(rule)}
                            >
                              <Edit size={12} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleDeleteRule(rule.id)}
                            >
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 p-4 border-t border-border bg-bg-elevated">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Annuleren
              </Button>
              <Button onClick={handleSaveAll}>
                <Save size={14} />
                Opslaan
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Rule Form Dialog */}
      <Dialog.Root open={ruleFormOpen} onOpenChange={setRuleFormOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] w-[600px] max-w-[90vw] bg-bg-surface border border-border rounded-lg shadow-xl p-6">
            <Dialog.Title className="text-lg font-semibold text-text-heading mb-4">
              {editingRule ? 'Regel bewerken' : 'Nieuwe regel toevoegen'}
            </Dialog.Title>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Conditie type
                  </label>
                  <Select 
                    value={ruleForm.condition_type} 
                    onValueChange={(value: RoutingConditionType) => 
                      setRuleForm(prev => ({ ...prev, condition_type: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROUTING_CONDITION_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-text-primary mb-2">
                    Waarde
                  </label>
                  <Input
                    value={ruleForm.condition_value}
                    onChange={(e) => setRuleForm(prev => ({ ...prev, condition_value: e.target.value }))}
                    placeholder={
                      ruleForm.condition_type === 'sender_domain' ? 'example.com' :
                      ruleForm.condition_type === 'subject_contains' ? 'urgent' :
                      mailboxEmail
                    }
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Toewijzen aan
                </label>
                <Select 
                  value={ruleForm.assign_to_user_id?.toString() || ''} 
                  onValueChange={(value) => 
                    setRuleForm(prev => ({ 
                      ...prev, 
                      assign_to_user_id: value ? parseInt(value) : null 
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecteer gebruiker (optioneel)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Niet toewijzen</SelectItem>
                    {assignableUsers.map(user => (
                      <SelectItem key={user.id} value={user.id.toString()}>
                        {user.name} ({user.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  Labels
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableLabels.map(label => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleLabelToggle(label)}
                      className={`px-2 py-1 text-xs rounded-full border transition-colors ${
                        ruleForm.labels.includes(label)
                          ? 'bg-accent/20 border-accent text-accent'
                          : 'border-border hover:bg-bg-hover'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={ruleForm.active}
                  onChange={(e) => setRuleForm(prev => ({ ...prev, active: e.target.checked }))}
                  className="rounded border-border"
                />
                <label htmlFor="active" className="text-sm text-text-primary">
                  Regel is actief
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => setRuleFormOpen(false)}>
                Annuleren
              </Button>
              <Button onClick={handleSaveRule} disabled={!ruleForm.condition_value.trim()}>
                <Save size={14} />
                {editingRule ? 'Bijwerken' : 'Toevoegen'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}