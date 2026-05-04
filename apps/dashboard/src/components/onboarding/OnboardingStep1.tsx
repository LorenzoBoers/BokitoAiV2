import { } from 'react';
import { Building2, Clock } from 'lucide-react';
import type { OnboardingStep1Data } from '../../types/custom-db';

interface OnboardingStep1Props {
  data: OnboardingStep1Data;
  onChange: (data: OnboardingStep1Data) => void;
}

const COMMON_TIMEZONES = [
  { value: 'Europe/Amsterdam', label: 'Amsterdam (CET/CEST)' },
  { value: 'Europe/Brussels', label: 'Brussels (CET/CEST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
  { value: 'America/New_York', label: 'New York (EST/EDT)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
];

export default function OnboardingStep1({ data, onChange }: OnboardingStep1Props) {
  const handleWorkspaceNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({
      ...data,
      workspace_name: e.target.value,
    });
  };

  const handleTimezoneChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...data,
      timezone: e.target.value,
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-accent/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-accent" />
        </div>
        <h2 className="text-2xl font-semibold text-text-heading mb-2">
          Maak je workspace
        </h2>
        <p className="text-text-secondary">
          Geef je workspace een naam en stel je tijdzone in
        </p>
      </div>

      <div className="space-y-6">
        {/* Workspace Name */}
        <div>
          <label htmlFor="workspace-name" className="block text-sm font-medium text-text-secondary mb-2">
            Workspace naam *
          </label>
          <input
            id="workspace-name"
            type="text"
            value={data.workspace_name}
            onChange={handleWorkspaceNameChange}
            placeholder="Bijv. Mijn Bedrijf, Team Alpha, ..."
            className="w-full px-4 py-3 rounded-md bg-bg-input border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-border-focus transition"
            autoFocus
          />
          <p className="text-xs text-text-muted mt-1">
            Dit is de naam van je organisatie of team workspace
          </p>
        </div>

        {/* Timezone */}
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium text-text-secondary mb-2">
            <Clock className="w-4 h-4 inline mr-1" />
            Tijdzone
          </label>
          <select
            id="timezone"
            value={data.timezone}
            onChange={handleTimezoneChange}
            className="w-full px-4 py-3 rounded-md bg-bg-input border border-border text-text-primary focus:outline-none focus:border-border-focus transition"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted mt-1">
            Dit bepaalt hoe datums en tijden worden weergegeven
          </p>
        </div>
      </div>

      {/* Preview */}
      {data.workspace_name && (
        <div className="p-4 bg-bg-muted rounded-lg border border-border">
          <p className="text-sm text-text-secondary mb-1">Voorbeeld:</p>
          <p className="font-medium text-text-primary">{data.workspace_name}</p>
          <p className="text-xs text-text-muted">
            Tijdzone: {COMMON_TIMEZONES.find(tz => tz.value === data.timezone)?.label}
          </p>
        </div>
      )}
    </div>
  );
}