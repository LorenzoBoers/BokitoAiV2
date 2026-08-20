import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Paintbrush, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent } from '../components/ui/card';
import { PageContent } from '../components/layout/PageContent';
import { SettingsSection } from '../components/layout/SettingsSection';
import { APP_API_BASE } from '../lib/api.config';

export default function WorkspaceSettings() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user, token } = useAuth();
  const { currentWorkspace, updateWorkspace, deleteWorkspace } = useWorkspace();
  const canManageWorkspace = usePermission('delete_workspace') || usePermission('invite_members');
  const canDeleteWorkspace = usePermission('delete_workspace');

  const [workspaceName, setWorkspaceName] = useState(currentWorkspace?.name || user?.tenant.name || '');
  const language = (i18n.resolvedLanguage === 'nl' ? 'nl' : 'en') as 'nl' | 'en';
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (currentWorkspace?.name) setWorkspaceName(currentWorkspace.name);
  }, [currentWorkspace?.id, currentWorkspace?.name]);

  // The saved ui_language preference is applied app-wide by
  // useLanguagePreferenceSync in App.tsx.

  const handleSave = async () => {
    if (!currentWorkspace) return;
    setSaving(true);
    try {
      await updateWorkspace(currentWorkspace.id, {
        name: workspaceName.trim(),
      });
      toast.success(t('saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const setLanguage = async (next: 'nl' | 'en') => {
    void i18n.changeLanguage(next);
    if (!token) return;
    try {
      const res = await fetch(`${APP_API_BASE}/me/preferences`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ ui_language: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Applied locally for this session, but won't survive a reload.
      toast.error('Language changed for this session, but could not be saved to your account.');
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!currentWorkspace || deleteConfirmation !== workspaceName) return;
    setDeleting(true);
    try {
      await deleteWorkspace(currentWorkspace.id);
      setShowDeleteDialog(false);
      window.location.assign('/');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageContent width="lg" className="space-y-6">
      <p className="text-sm text-text-secondary">
        {t('description')}
      </p>

      <SettingsSection
        title={t('generalTitle')}
        actions={
          canManageWorkspace ? (
            <Button onClick={() => void handleSave()} size="sm" disabled={saving || !currentWorkspace}>
              {t('saveSettings')}
            </Button>
          ) : null
        }
      >
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t('workspaceName')}
            </label>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              disabled={!canManageWorkspace}
              className="max-w-md"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Branding
            </label>
            <Link
              to="/settings/branding"
              className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-bg-input/40 px-4 py-3 hover:bg-bg-hover/50 hover:border-border/60 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Paintbrush size={15} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-heading">Organization branding</p>
                  <p className="text-xs text-text-muted">Manage logo, colors and branding</p>
                </div>
              </div>
              <ArrowRight size={15} className="text-text-muted group-hover:text-text-secondary transition-colors" />
            </Link>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Your language">
        <div>
          <label className="block text-sm font-medium text-text-primary mb-2">
            <Globe size={16} className="inline mr-2" />
            {t('language')}
          </label>
          <p className="mb-3 text-xs text-text-muted">
            Personal preference for your account — applied immediately.
          </p>
          <div className="flex gap-2">
            <Button
              variant={language === 'nl' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => void setLanguage('nl')}
            >
              {t('languageDutch')}
            </Button>
            <Button
              variant={language === 'en' ? 'default' : 'secondary'}
              size="sm"
              onClick={() => void setLanguage('en')}
            >
              {t('languageEnglish')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {canDeleteWorkspace && (
        <Card className="border-status-error/40 bg-status-error/5">
          <CardContent>
            <h2 className="mb-3 text-base font-semibold text-status-error">
              {t('dangerTitle')}
            </h2>
            <div className="space-y-4">
              <div>
                <h3 className="mb-2 font-medium text-text-heading">
                  {t('deleteWorkspaceTitle')}
                </h3>
                <p className="mb-4 text-sm text-text-secondary">
                  {t('deleteWorkspaceDescription')}
                </p>
                <Button
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  {t('deleteWorkspaceButton')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-heading mb-4">
              {t('deleteDialogTitle')}
            </h3>
            <p className="text-sm text-text-secondary mb-4">
              {t('deleteDialogPrompt', { name: workspaceName })}
            </p>
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={workspaceName}
              className="mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowDeleteDialog(false)}>
                {t('common:cancel', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirmation !== workspaceName || deleting}
                onClick={() => void handleDeleteWorkspace()}
              >
                {t('deleteConfirmButton')}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageContent>
  );
}
