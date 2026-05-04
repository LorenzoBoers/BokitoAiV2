import React, { useState } from 'react';
import { Upload, Trash2, Globe, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';

const TIMEZONES = [
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
];

export default function WorkspaceSettings() {
  const { user } = useAuth();
  const canManageWorkspace = usePermission('delete_workspace') || usePermission('invite_members');
  
  const [workspaceName, setWorkspaceName] = useState(user?.tenant.name || '');
  const [timezone, setTimezone] = useState('Europe/Amsterdam');
  const [language, setLanguage] = useState<'nl' | 'en'>('nl');
  const [require2FA, setRequire2FA] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.size <= 1024 * 1024) { // 1MB limit
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogo(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      alert('Bestand moet kleiner zijn dan 1MB');
    }
  };

  const handleSave = () => {
    // In a real app, this would save to the backend
    console.log('Saving workspace settings:', {
      name: workspaceName,
      timezone,
      language,
      require2FA,
      logo
    });
    alert('Instellingen opgeslagen!');
  };

  const handleDeleteWorkspace = () => {
    if (deleteConfirmation === workspaceName) {
      // In a real app, this would delete the workspace
      console.log('Deleting workspace:', workspaceName);
      alert('Workspace zou nu worden verwijderd (demo)');
      setShowDeleteDialog(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-heading mb-2">
          Workspace instellingen
        </h1>
        <p className="text-text-muted">
          Beheer de algemene instellingen van je workspace
        </p>
      </div>

      {/* General Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          Algemene instellingen
        </h2>
        
        <div className="space-y-6">
          {/* Workspace Name */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Workspace naam
            </label>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              disabled={!canManageWorkspace}
              className="max-w-md"
            />
          </div>

          {/* Logo Upload */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Logo
            </label>
            <div className="flex items-center gap-4">
              {logo ? (
                <div className="relative">
                  <img
                    src={logo}
                    alt="Workspace logo"
                    className="w-16 h-16 rounded-lg object-cover border border-border"
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 w-6 h-6"
                    onClick={() => setLogo(null)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center">
                  <Upload size={20} className="text-text-muted" />
                </div>
              )}
              
              <div>
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleLogoUpload}
                  className="hidden"
                  id="logo-upload"
                  disabled={!canManageWorkspace}
                />
                <label htmlFor="logo-upload">
                  <Button
                    variant="secondary"
                    size="sm"
                    asChild
                    disabled={!canManageWorkspace}
                  >
                    <span>Upload logo</span>
                  </Button>
                </label>
                <p className="text-xs text-text-muted mt-1">
                  JPG of PNG, max 1MB
                </p>
              </div>
            </div>
          </div>

          {/* Timezone */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Clock size={16} className="inline mr-2" />
              Tijdzone
            </label>
            <Select
              value={timezone}
              onValueChange={setTimezone}
              disabled={!canManageWorkspace}
            >
              {TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Language */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              <Globe size={16} className="inline mr-2" />
              Taal
            </label>
            <div className="flex gap-2">
              <Button
                variant={language === 'nl' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setLanguage('nl')}
                disabled={!canManageWorkspace}
              >
                Nederlands
              </Button>
              <Button
                variant={language === 'en' ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setLanguage('en')}
                disabled={!canManageWorkspace}
              >
                English
              </Button>
            </div>
          </div>
        </div>

        {canManageWorkspace && (
          <div className="flex justify-end mt-6 pt-6 border-t border-border">
            <Button onClick={handleSave}>
              Instellingen opslaan
            </Button>
          </div>
        )}
      </Card>

      {/* Security Settings */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          Beveiliging
        </h2>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-text-primary">
                Verplichte 2FA voor alle leden
              </h3>
              <p className="text-sm text-text-muted">
                Alle workspace leden moeten 2FA inschakelen
              </p>
            </div>
            <Button
              variant={require2FA ? 'default' : 'secondary'}
              size="sm"
              onClick={() => setRequire2FA(!require2FA)}
              disabled={!usePermission('delete_workspace')} // Only owners
            >
              {require2FA ? 'Ingeschakeld' : 'Uitgeschakeld'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Danger Zone */}
      {usePermission('delete_workspace') && (
        <Card className="p-6 border-red-200 bg-red-50/50">
          <h2 className="text-lg font-semibold text-red-800 mb-4">
            Gevaarlijke acties
          </h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-red-700 mb-2">
                Workspace verwijderen
              </h3>
              <p className="text-sm text-red-600 mb-4">
                Deze actie kan niet ongedaan worden gemaakt. Alle data wordt permanent verwijderd.
              </p>
              
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                Workspace verwijderen
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-heading mb-4">
              Workspace verwijderen
            </h3>
            
            <p className="text-text-muted mb-4">
              Type de naam van de workspace <strong>"{workspaceName}"</strong> om te bevestigen:
            </p>
            
            <Input
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="Workspace naam"
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
                Annuleren
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteWorkspace}
                disabled={deleteConfirmation !== workspaceName}
              >
                Permanent verwijderen
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}