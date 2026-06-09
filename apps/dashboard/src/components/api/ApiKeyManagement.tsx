import { useState } from 'react';
import { Copy, Plus, Trash2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { useApi } from '../../context/ApiContext';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import type { ApiKey } from '../../types/api';

interface CreateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onKeyCreated: (key: ApiKey) => void;
}

function CreateKeyDialog({ open, onOpenChange, onKeyCreated }: CreateKeyDialogProps) {
  const { createApiKey, loading } = useApi();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'read_write'>('read');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      const newKey = await createApiKey(name.trim(), scope);
      onKeyCreated(newKey);
      setName('');
      setScope('read');
      onOpenChange(false);
      toast.success('API sleutel aangemaakt');
    } catch (error) {
      toast.error('Fout bij aanmaken API sleutel');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nieuwe API Sleutel</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="key-name">Naam</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="bijv. Production API"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="key-scope">Rechten</Label>
            <Select value={scope} onValueChange={(value: 'read' | 'read_write') => setScope(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Alleen lezen</SelectItem>
                <SelectItem value="read_write">Lezen en schrijven</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Annuleren
            </Button>
            <Button type="submit" disabled={loading.apiKeys || !name.trim()}>
              {loading.apiKeys ? 'Aanmaken...' : 'Aanmaken'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface KeyRevealDialogProps {
  apiKey: ApiKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function KeyRevealDialog({ apiKey, open, onOpenChange }: KeyRevealDialogProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(apiKey.key);
      setCopied(true);
      toast.success('API sleutel gekopieerd');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kon niet kopiëren naar klembord');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API Sleutel - {apiKey.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-bg-subtle border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-secondary">API Sleutel</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyToClipboard}
                className="h-8 px-2"
              >
                <Copy size={14} />
                {copied ? 'Gekopieerd!' : 'Kopiëren'}
              </Button>
            </div>
            <code className="block text-sm font-mono bg-bg border border-border rounded px-3 py-2 break-all">
              {apiKey.key}
            </code>
          </div>
          
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 dark:bg-yellow-900/20 dark:border-yellow-800">
            <div className="flex items-start space-x-3">
              <AlertTriangle size={20} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  Bewaar deze sleutel veilig
                </p>
                <p className="text-yellow-700 dark:text-yellow-300">
                  Deze sleutel wordt slechts één keer getoond. Bewaar hem op een veilige plek.
                  Als je hem verliest, moet je een nieuwe aanmaken.
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => onOpenChange(false)}>
              Begrepen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteKeyDialogProps {
  apiKey: ApiKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DeleteKeyDialog({ apiKey, open, onOpenChange }: DeleteKeyDialogProps) {
  const { revokeApiKey, loading } = useApi();

  const handleDelete = async () => {
    try {
      await revokeApiKey(apiKey.id);
      onOpenChange(false);
      toast.success('API sleutel ingetrokken');
    } catch (error) {
      toast.error('Fout bij intrekken API sleutel');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>API Sleutel Intrekken</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Are you sure you want to revoke the API key "{apiKey.name}"?
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
              disabled={loading.apiKeys}
            >
              {loading.apiKeys ? 'Intrekken...' : 'Intrekken'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ApiKeyManagement() {
  const { apiKeys } = useApi();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<ApiKey | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-NL', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getScopeLabel = (scope: 'read' | 'read_write') => {
    return scope === 'read' ? 'Alleen lezen' : 'Lezen en schrijven';
  };

  const getScopeBadgeColor = (scope: 'read' | 'read_write') => {
    return scope === 'read' 
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
      : 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-heading">API Sleutels</h2>
          <p className="text-sm text-text-secondary">
            Beheer API sleutels voor toegang tot je data
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="flex items-center gap-2">
          <Plus size={16} />
          Nieuwe Sleutel
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-12 h-12 mx-auto mb-4 bg-bg-subtle rounded-lg flex items-center justify-center">
            <Plus size={24} className="text-text-muted" />
          </div>
          <h3 className="text-lg font-medium text-text-heading mb-2">No API keys</h3>
          <p className="text-text-secondary mb-4">
            Maak je eerste API sleutel aan om toegang te krijgen tot de API
          </p>
          <Button onClick={() => setCreateDialogOpen(true)}>
            Eerste Sleutel Aanmaken
          </Button>
        </div>
      ) : (
        <div className="bg-bg border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-subtle">
                <tr>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Naam</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Sleutel</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Rechten</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Aangemaakt</th>
                  <th className="text-left px-4 py-3 text-sm font-medium text-text-secondary">Laatst gebruikt</th>
                  <th className="text-right px-4 py-3 text-sm font-medium text-text-secondary">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {apiKeys.map((key) => (
                  <tr key={key.id} className="hover:bg-bg-hover/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-text-heading">{key.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-sm font-mono text-text-secondary bg-bg-subtle px-2 py-1 rounded">
                        {key.maskedKey}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getScopeBadgeColor(key.scope)}`}>
                        {getScopeLabel(key.scope)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {formatDate(key.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-secondary">
                      {key.lastUsed ? formatDate(key.lastUsed) : 'Nooit'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevealKey(key)}
                          className="h-8 px-2"
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteKey(key)}
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

      <CreateKeyDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onKeyCreated={(key) => setRevealKey(key)}
      />

      {revealKey && (
        <KeyRevealDialog
          apiKey={revealKey}
          open={!!revealKey}
          onOpenChange={(open) => !open && setRevealKey(null)}
        />
      )}

      {deleteKey && (
        <DeleteKeyDialog
          apiKey={deleteKey}
          open={!!deleteKey}
          onOpenChange={(open) => !open && setDeleteKey(null)}
        />
      )}
    </div>
  );
}