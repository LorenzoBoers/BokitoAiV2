import { FolderKanban, Link2, SkipForward } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { OnboardingStep2Data } from '../../types/custom-db'

interface OnboardingStep2Props {
  data: OnboardingStep2Data
  onChange: (data: OnboardingStep2Data) => void
}

const SURFACE_OPTIONS = [
  {
    id: 'channel' as const,
    name: 'Connect a channel',
    description: 'Link email or chat so customer signals land in Messages.',
    icon: Link2,
    href: '/settings/channels',
  },
  {
    id: 'project' as const,
    name: 'Set up your agents',
    description: 'Review your agent team and configure automations and triggers.',
    icon: FolderKanban,
    href: '/agents',
  },
  {
    id: 'skip' as const,
    name: 'Skip for now',
    description: 'Explore the workspace and configure surfaces later.',
    icon: SkipForward,
    href: null,
  },
]

export default function OnboardingStep2({ data, onChange }: OnboardingStep2Props) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold text-text-heading mb-2">Choose your first operational surface</h2>
        <p className="text-text-secondary">
          Bokito unifies Messages, agents, and human decisions. Start where your team feels the most pain today.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {SURFACE_OPTIONS.map((option) => {
          const Icon = option.icon
          const isSelected = data.first_surface === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange({ first_surface: option.id })}
              className={`p-4 rounded-lg border-2 text-left transition-all hover:border-accent/50 ${
                isSelected
                  ? 'border-accent bg-accent/5'
                  : 'border-border bg-bg-surface hover:bg-bg-muted/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`p-2 rounded-md ${
                    isSelected ? 'bg-accent text-white' : 'bg-bg-muted text-text-muted'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-text-primary mb-1">{option.name}</h3>
                  <p className="text-sm text-text-secondary">{option.description}</p>
                  {isSelected && option.href ? (
                    <Link
                      to={option.href}
                      className="inline-block mt-2 text-xs font-medium text-accent hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open setup
                    </Link>
                  ) : null}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-text-muted text-center">
        New workspaces start on the Assisted autonomy posture. Adjust trust levels anytime in Settings &gt; Autonomy &amp; approvals.
      </p>
    </div>
  )
}
