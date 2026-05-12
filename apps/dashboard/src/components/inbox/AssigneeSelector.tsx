import { useEffect, useState } from 'react'
import { UserCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { listInboxMembers, type InboxMember } from '../../lib/inbox-api'

type Props = {
  currentAssigneeId: number | null
  onChange: (userId: number | null) => void
  disabled?: boolean
}

export default function AssigneeSelector({ currentAssigneeId, onChange, disabled }: Props) {
  const { token } = useAuth()
  const [members, setMembers] = useState<InboxMember[]>([])

  useEffect(() => {
    if (!token) return
    listInboxMembers(token)
      .then(setMembers)
      .catch(() => {})
  }, [token])

  return (
    <div className="flex items-center gap-1.5">
      <UserCheck size={13} className="text-text-muted shrink-0" />
      <select
        value={currentAssigneeId ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        disabled={disabled}
        className="rounded border border-border bg-bg-surface py-0.5 px-1.5 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
      >
        <option value="">Niet toegewezen</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}
