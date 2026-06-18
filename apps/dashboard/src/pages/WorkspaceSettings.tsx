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


export default function WorkspaceSettings() {
  const { t, i18n } = useTranslation(['workspace', 'common']);
  const { user } = useAuth();
  const { currentWorkspace, updateWorkspace, deleteWorkspace } = useWorkspace();
  const canManageWorkspace = usePermission('delete_workspace') || usePermission('invite_members');

  const [workspaceName, setWorkspaceName] = useState(currentWorkspace?.name || user?.tenant.name || '');
  const language = (i18n.resolvedLanguage === 'nl' ? 'nl' : 'en') as 'nl' | 'en';
  const [require2FA, setRequire2FA] = useState(currentWorkspace?.require_2fa ?? false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (currentWorkspace?.name) setWorkspaceName(currentWorkspace.name);
    setRequire2FA(currentWorkspace?.require_2fa ?? false);
  }, [currentWorkspace?.id, currentWorkspace?.name, currentWorkspace?.require_2fa]);

  const handleSave = async () => {
    if (!currentWorkspace) return;
    setSaving(true);
    try {
      await updateWorkspace(currentWorkspace.id, {
        name: workspaceName.trim(),
        require_2fa: require2FA,
      });
      toast.success(t('saveSuccess'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setSaving(false);
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
          {/* Workspace Name */}
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

          {/* Branding link */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Branding
            </label>
            <Link
              to="/settings/branding"
              className="flex items-center justify-between gap-3 rounded-lg border border-border/55 bg-bg-input/40 px-4 py-3 hover:bg-bg-hover/50 hover:border-border/80 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Paintbrush size={15} className="text-accent" />
                </div>
                <div>
                  <p className="text-sm font-medium text-text-heading">Organisatie branding</p>
                  <p className="text-xs text-text-muted">Logo, kleuren en huisstijl beheren</p>
                </div>
              </div>
              <ArrowRight size={15} className="text-text-muted group-hover:text-text-secondary transition-colors" />
            </Link>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Globe size={16} className="inline mr-2" />
              {t('language')}
            </label>
            <div className="flex gap-2">
              <Button
                variant={language === 'nl' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => i18n.changeLanguage('nl')}
                disabled={!canManageWorkspace}
              >
                {t('languageDutch')}
              </Button>
              <Button
                variant={language === 'en' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => i18n.changeLanguage('en')}
                disabled={!canManageWorkspace}
              >
                {t('languageEnglish')}
              </Button>
            </div>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('securityTitle')}>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-text-primary">
                {t('require2faTitle')}
              </h3>
              <p className="text-sm text-text-muted">
                {t('require2faDescription')}
              </p>
            </div>
            <Button
              variant={require2FA ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setRequire2FA(!require2FA)}
              disabled={!usePermission('delete_workspace')}
            >
              {require2FA ? t('enabled') : t('disabled')}
            </Button>
          </div>
        </div>
      </SettingsSection>

      {usePermission('delete_workspace') && (
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

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-heading mb-4">
              {t('deleteDialogTitle')}
            </h3>
            
            <p className="text-text-muted mb-4">
              {t('deleteDialogPrompt', { name: workspaceName })}
            </p>
            
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={t('workspaceNamePlaceholder')}
              className="mb-4"
            />
            
            <div className="flex gap-2 justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowDeleteDialog(false);
                  setDeleteConfirmation('');
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void handleDeleteWorkspace()}
                disabled={deleteConfirmation !== workspaceName || deleting}
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