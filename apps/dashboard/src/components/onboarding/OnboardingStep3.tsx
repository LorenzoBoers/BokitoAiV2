import { useState } from 'react';
import { UserPlus, Mail, X, Plus } from 'lucide-react';
import type { OnboardingStep3Data } from '../../types/custom-db';

interface OnboardingStep3Props {
  data: OnboardingStep3Data;
  onChange: (data: OnboardingStep3Data) => void;
}

const ROLES = [
  { value: 'admin' as const, label: 'Admin', description: 'Volledige toegang tot alles' },
  { value: 'member' as const, label: 'Lid', description: 'Kan data bekijken en bewerken' },
  { value: 'viewer' as const, label: 'Kijker', description: 'Kan alleen data bekijken' },
];

export default function OnboardingStep3({ data, onChange }: OnboardingStep3Props) {
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'member' | 'viewer'>('member');

  const addInvite = () => {
    if (!newEmail.trim()) return;
    
    // Check if email already exists
    if (data.invites.some(invite => invite.email.toLowerCase() === newEmail.toLowerCase())) {
      return;
    }

    onChange({
      ...data,
      invites: [
        ...data.invites,
        { email: newEmail.trim(), role: newRole },
      ],
    });

    setNewEmail('');
    setNewRole('member');
  };

  const removeInvite = (index: number) => {
    onChange({
      ...data,
      invites: data.invites.filter((_, i) => i !== index),
    });
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addInvite();
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <UserPlus className="w-8 h-8 text-accent" />
        </div>
        <h2 className="text-2xl font-semibold text-text-heading mb-2">
          Nodig teamleden uit
        </h2>
        <p className="text-text-secondary">
          Voeg collega's toe aan je workspace (optioneel - je kunt dit later ook doen)
        </p>
      </div>

      {/* Add Invite Form */}
      <div className="p-4 bg-bg-muted rounded-lg border border-border">
        <div className="flex gap-3">
          <div className="flex-1">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="E-mailadres van teamlid"
              className="w-full px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-border-focus transition"
            />
          </div>
          <div>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as typeof newRole)}
              className="px-3 py-2 rounded-md bg-bg-input border border-border text-text-primary text-sm focus:outline-none focus:border-border-focus transition"
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addInvite}
            disabled={!newEmail.trim()}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Role Descriptions */}
        <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
          {ROLES.map((role) => (
            <div
              key={role.value}
              className={`p-2 rounded border ${
                newRole === role.value
                  ? 'border-accent bg-accent/5 text-accent'
                  : 'border-border bg-bg-surface text-text-muted'
              }`}
            >
              <div className="font-medium">{role.label}</div>
              <div>{role.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Invites List */}
      {data.invites.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-secondary">
            Uitnodigingen ({data.invites.length})
          </h3>
          <div className="space-y-2">
            {data.invites.map((invite, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-bg-surface border border-border rounded-md"
              >
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-text-muted" />
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {invite.email}
                    </p>
                    <p className="text-xs text-text-muted">
                      {ROLES.find(r => r.value === invite.role)?.label}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => removeInvite(index)}
                  className="p-1 hover:bg-bg-muted rounded-md transition-colors"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {data.invites.length === 0 && (
        <div className="text-center py-8">
          <UserPlus className="w-12 h-12 text-text-muted mx-auto mb-3" />
          <p className="text-text-secondary mb-1">No invitations yet</p>
          <p className="text-sm text-text-muted">
            Voeg e-mailadressen toe om teamleden uit te nodigen
          </p>
        </div>
      )}

      {/* Info */}
      <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>Let op:</strong> Uitgenodigde personen ontvangen een e-mail met een link om zich aan te melden 
          en toegang te krijgen tot je workspace. Je kunt altijd later meer mensen uitnodigen.
        </p>
      </div>
    </div>
  );
}