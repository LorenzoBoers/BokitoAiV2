import { useState } from 'react';
import { Plus, Trash2, Edit, Globe, AlertCircle, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useApi } from '../../context/ApiContext';
import { useDatabase } from '../../context/DatabaseContext';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import type { Webhook, WebhookTrigger } from '../../types/api';

interface CreateWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CreateWebhookDialog({ open, onOpenChange }: CreateWebhookDialogProps) {
  const { createWebhook, loading } = useApi();
  const { tables } = useDatabase();
  const [formData, setFormData] = useState({
    tableId: '',
    url: '',
    secret: '',
    triggers: {
      create: true,
      update: true,
      delete: false,
    } as WebhookTrigger,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.tableId || !formData.url) return;

    try {
      await createWebhook(
        parseInt(formData.tableId),
        formData.url,
        formData.triggers,
        formData.secret || undefined
      );
      setFormData({
        tableId: '',
        url: '',
        secret: '',
        triggers: { create: true, update: true, delete: false },
      });
      onOpenChange(false);
      toast.success('Webhook aangemaakt');
    } catch (error) {
      toast.error('Fout bij aanmaken webhook');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nieuwe Webhook</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="webhook-table">Tabel</Label>
            <Select 
              value={formData.tableId} 
              onValueChange={(value) => setFormData(prev => ({ ...prev, tableId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecteer een tabel" />
              </SelectTrigger>
              <SelectContent>
                {tables.map((table) => (
                  <SelectItem key={table.id} value={table.id.toString()}>
                    <div className="flex items-center space-x-2">
                      <div 
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: table.color }}
                      />
                      <span>{table.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-url">Webhook URL</Label>
            <Input
              id="webhook-url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              placeholder="https://api.example.com/webhooks"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="webhook-secret">Secret (optioneel)</Label>
            <Input
              id="webhook-secret"
              type="password"
              value={formData.secret}
              onChange={(e) => setFormData(prev => ({ ...prev, secret: e.target.value }))}
              placeholder="Voor het verifiëren van webhook payloads"
            />
            <p className="text-xs text-text-muted">
              Wordt gebruikt om de webhook signature te verifiëren
            </p>
          </div>

          <div className="space-y-3">
            <Label>Triggers</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="trigger-create" className="text-sm font-normal">
                    Record aangemaakt
                  </Label>
                  <p className="text-xs text-text-muted">
                    Webhook wordt getriggerd bij nieuwe records
                  </p>
                </div>
                <Switch
                  id="trigger-create"
                  checked={formData.triggers.create}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, create: checked }
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="trigger-update" className="text-sm font-normal">
                    Record bijgewerkt
                  </Label>
                  <p className="text-xs text-text-muted">
                    Webhook wordt getriggerd bij updates
                  </p>
                </div>
                <Switch
                  id="trigger-update"
                  checked={formData.triggers.update}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, update: checked }
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="trigger-delete" className="text-sm font-normal">
                    Record verwijderd
                  </Label>
                  <p className="text-xs text-text-muted">
                    Webhook wordt getriggerd bij verwijderingen
                  </p>
                </div>
                <Switch
                  id="trigger-delete"
                  checked={formData.triggers.delete}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, delete: checked }
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuleren
            </Button>
            <Button 
              type="submit" 
              disabled={loading.webhooks || !formData.tableId || !formData.url}
            >
              {loading.webhooks ? 'Aanmaken...' : 'Aanmaken'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface EditWebhookDialogProps {
  webhook: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditWebhookDialog({ webhook, open, onOpenChange }: EditWebhookDialogProps) {
  const { updateWebhook, loading } = useApi();
  const [formData, setFormData] = useState({
    url: webhook.url,
    secret: webhook.secret || '',
    triggers: webhook.triggers,
    isActive: webhook.isActive,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await updateWebhook(webhook.id, {
        url: formData.url,
        secret: formData.secret || undefined,
        triggers: formData.triggers,
        isActive: formData.isActive,
      });
      onOpenChange(false);
      toast.success('Webhook bijgewerkt');
    } catch (error) {
      toast.error('Fout bij bijwerken webhook');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit webhook</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-webhook-url">Webhook URL</Label>
            <Input
              id="edit-webhook-url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-webhook-secret">Secret</Label>
            <Input
              id="edit-webhook-secret"
              type="password"
              value={formData.secret}
              onChange={(e) => setFormData(prev => ({ ...prev, secret: e.target.value }))}
              placeholder="Laat leeg om ongewijzigd te laten"
            />
          </div>

          <div className="space-y-3">
            <Label>Triggers</Label>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-trigger-create" className="text-sm font-normal">
                  Record aangemaakt
                </Label>
                <Switch
                  id="edit-trigger-create"
                  checked={formData.triggers.create}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, create: checked }
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-trigger-update" className="text-sm font-normal">
                  Record bijgewerkt
                </Label>
                <Switch
                  id="edit-trigger-update"
                  checked={formData.triggers.update}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, update: checked }
                    }))
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-trigger-delete" className="text-sm font-normal">
                  Record verwijderd
                </Label>
                <Switch
                  id="edit-trigger-delete"
                  checked={formData.triggers.delete}
                  onCheckedChange={(checked) => 
                    setFormData(prev => ({ 
                      ...prev, 
                      triggers: { ...prev.triggers, delete: checked }
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-webhook-active" className="text-sm font-normal">
              Webhook actief
            </Label>
            <Switch
              id="edit-webhook-active"
              checked={formData.isActive}
              onCheckedChange={(checked) => 
                setFormData(prev => ({ ...prev, isActive: checked }))
              }
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuleren
            </Button>
            <Button type="submit" disabled={loading.webhooks}>
              {loading.webhooks ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteWebhookDialogProps {
  webhook: Webhook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DeleteWebhookDialog({ webhook, open, onOpenChange }: DeleteWebhookDialogProps) {
  const { deleteWebhook, loading } = useApi();

  const handleDelete = async () => {
    try {
      await deleteWebhook(webhook.id);
      onOpenChange(false);
      toast.success('Webhook verwijderd');
    } catch (error) {
      toast.error('Fout bij verwijderen webhook');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete webhook</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to delete the webhook for "{webhook.tableName}"?
            Deze actie kan niet ongedaan worden gemaakt.
          </p>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuleren
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading.webhooks}
            >
              {loading.webhooks ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function WebhookConfiguration() {
  const { webhooks } = useApi();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editWebhook, setEditWebhook] = useState<Webhook | null>(null);
  const [deleteWebhook, setDeleteWebhook] = useState<Webhook | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTriggerLabels = (triggers: WebhookTrigger) => {
    const active = [];
    if (triggers.create) active.push('Create');
    if (triggers.update) active.push('Update');
    if (triggers.delete) active.push('Delete');
    return active.join(', ') || 'Geen';
  };

  const getStatusIcon = (webhook: Webhook) => {
    if (!webhook.isActive) {
      return <XCircle size={16} className="text-gray-500" />;
    }
    
    if (!webhook.lastDelivery) {
      return <Clock size={16} className="text-yellow-500" />;
    }

    if (webhook.lastDelivery.status >= 200 && webhook.lastDelivery.status < 300) {
      return <CheckCircle size={16} className="text-green-500" />;
    }

    return <AlertCircle size={16} className="text-red-500" />;
  };

  const getStatusText = (webhook: Webhook) => {
    if (!webhook.isActive) return 'Inactief';
    if (!webhook.lastDelivery) return 'Nog niet getriggerd';
    if (webhook.lastDelivery.status >= 200 && webhook.lastDelivery.status < 300) {
      return 'Laatste delivery succesvol';
    }
    return `Laatste delivery gefaald (${webhook.lastDelivery.status})`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-heading">Webhooks</h2>
          <p className="text-sm text-text-secondary">
            Configureer webhooks om notificaties te ontvangen bij wijzigingen
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
          <Plus size={16} />
          Nieuwe Webhook
        </Button>
      </div>

      {webhooks.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 bg-bg-subtle rounded-lg flex items-center justify-center">
            <Globe size={24} className="text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-heading mb-2">No webhooks</h3>
          <p className="text-text-secondary mb-4">
            Maak je eerste webhook aan om notificaties te ontvangen
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            Eerste Webhook Aanmaken
          </Button>
        </div>
      ) : (
        <div className="bg-bg border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-subtle">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Tabel</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">URL</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Triggers</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Status</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Laatste Delivery</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {webhooks.map((webhook) => (
                  <tr key={webhook.id} className="hover:bg-bg-hover/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-heading">{webhook.tableName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-sm font-mono text-text-secondary bg-bg-subtle px-2 py-1 rounded max-w-xs truncate block">
                        {webhook.url}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-text-secondary">
                        {getTriggerLabels(webhook.triggers)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-2">
                        {getStatusIcon(webhook)}
                        <span className="text-sm text-text-secondary">
                          {getStatusText(webhook)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {webhook.lastDelivery 
                        ? formatDate(webhook.lastDelivery.timestamp)
                        : 'Nooit'
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditWebhook(webhook)}
                          className="h-8 px-2"
                        >
                          <Edit size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteWebhook(webhook)}
                          className="h-8 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-bg-subtle border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-heading mb-3">Webhook Informatie</h3>
        <div className="space-y-3 text-sm text-text-secondary">
          <div>
            <strong>Retry Policy:</strong> 3 pogingen met exponential backoff (5s, 30s, 5min)
          </div>
          <div>
            <strong>Timeout:</strong> 30 seconden per request
          </div>
          <div>
            <strong>Payload Format:</strong> JSON met event type, table info, en record data
          </div>
          <div>
            <strong>Headers:</strong> Content-Type: application/json, X-Bokito-Event, X-Bokito-Signature (indien secret)
          </div>
          <div>
            <strong>Signature Verificatie:</strong> HMAC-SHA256 van payload met je secret als key
          </div>
        </div>
      </div>

      <CreateWebhookDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />

      {editWebhook && (
        <EditWebhookDialog
          webhook={editWebhook}
          open={!!editWebhook}
          onOpenChange={(open) => !open && setEditWebhook(null)}
        />
      )}

      {deleteWebhook && (
        <DeleteWebhookDialog
          webhook={deleteWebhook}
          open={!!deleteWebhook}
          onOpenChange={(open) => !open && setDeleteWebhook(null)}
        />
      )}
    </div>
  );
}