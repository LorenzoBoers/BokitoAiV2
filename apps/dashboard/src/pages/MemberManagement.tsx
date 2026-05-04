import React, { useState } from 'react';
import { UserPlus, Mail, Crown, Shield, Edit, Eye, Trash2, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { WorkspaceMember, PendingInvite, UserRole } from '../types/custom-db';

const ROLE_ICONS = {
  owner: Crown,
  admin: Shield,
  editor: Edit,
  viewer: Eye,
};

const ROLE_LABELS = {
  owner: 'Eigenaar',
  admin: 'Beheerder',
  editor: 'Editor',
  viewer: 'Kijker',
};

const ROLE_DESCRIPTIONS = {
  owner: 'Volledige toegang tot alles, inclusief workspace verwijderen',
  admin: 'Kan alles behalve workspace verwijderen',
  editor: 'Kan records en schema bewerken',
  viewer: 'Kan alleen data bekijken',
};

// Mock data
const mockMembers: WorkspaceMember[] = [
  {
    id: 1,
    name: 'Sarah van der Berg',
    email: 'sarah@bedrijf.nl',
    role: 'owner',
    avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=32&h=32&fit=crop&crop=face',
    joinedAt: '2024-01-15T10:00:00Z',
    status: 'active',
  },
  {
    id: 2,
    name: 'Mark Jansen',
    email: 'mark@bedrijf.nl',
    role: 'admin',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face',
    joinedAt: '2024-01-20T14:30:00Z',
    status: 'active',
  },
  {
    id: 3,
    name: 'Lisa de Wit',
    email: 'lisa@bedrijf.nl',
    role: 'editor',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=32&h=32&fit=crop&crop=face',
    joinedAt: '2024-02-01T09:15:00Z',
    status: 'active',
  },
  {
    id: 4,
    name: 'Tom Bakker',
    email: 'tom@bedrijf.nl',
    role: 'viewer',
    joinedAt: '2024-02-10T16:45:00Z',
    status: 'active',
  },
];

const mockPendingInvites: PendingInvite[] = [
  {
    id: 1,
    email: 'nieuwe.collega@bedrijf.nl',
    role: 'editor',
    invitedBy: 'Sarah van der Berg',
    invitedAt: '2024-03-01T10:00:00Z',
    expiresAt: '2024-03-08T10:00:00Z',
  },
  {
    id: 2,
    email: 'consultant@extern.nl',
    role: 'viewer',
    invitedBy: 'Mark Jansen',
    invitedAt: '2024-03-02T14:30:00Z',
    expiresAt: '2024-03-09T14:30:00Z',
  },
];

export default function MemberManagement() {
  const { user } = useAuth();
  const canInviteMembers = usePermission('invite_members');
  
  const [members, setMembers] = useState<WorkspaceMember[]>(mockMembers);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(mockPendingInvites);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('viewer');
  const [showInviteForm, setShowInviteForm] = useState(false);

  const handleInviteMember = () => {
    if (!inviteEmail) return;

    const newInvite: PendingInvite = {
      id: Date.now(),
      email: inviteEmail,
      role: inviteRole,
      invitedBy: user?.name || 'Onbekend',
      invitedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    };

    setPendingInvites(prev => [...prev, newInvite]);
    setInviteEmail('');
    setInviteRole('viewer');
    setShowInviteForm(false);
    
    // In a real app, this would send an email
    alert(`Uitnodiging verstuurd naar ${inviteEmail}`);
  };

  const handleRevokeInvite = (inviteId: number) => {
    setPendingInvites(prev => prev.filter(invite => invite.id !== inviteId));
  };

  const handleChangeRole = (memberId: number, newRole: UserRole) => {
    setMembers(prev => 
      prev.map(member => 
        member.id === memberId ? { ...member, role: newRole } : member
      )
    );
  };

  const handleRemoveMember = (memberId: number) => {
    if (confirm('Weet je zeker dat je dit lid wilt verwijderen?')) {
      setMembers(prev => prev.filter(member => member.id !== memberId));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-heading mb-2">
            Leden beheren
          </h1>
          <p className="text-text-muted">
            Beheer wie toegang heeft tot je workspace
          </p>
        </div>
        
        {canInviteMembers && (
          <Button onClick={() => setShowInviteForm(true)}>
            <UserPlus size={16} />
            Lid uitnodigen
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInviteForm && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-heading mb-4">
            Nieuw lid uitnodigen
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                E-mailadres
              </label>
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="naam@bedrijf.nl"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Rol
              </label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as UserRole)}>
                <option value="viewer">Kijker</option>
                <option value="editor">Editor</option>
                <option value="admin">Beheerder</option>
              </Select>
            </div>
            
            <div className="flex items-end gap-2">
              <Button onClick={handleInviteMember} disabled={!inviteEmail}>
                <Mail size={16} />
                Uitnodigen
              </Button>
              <Button 
                variant="secondary" 
                onClick={() => {
                  setShowInviteForm(false);
                  setInviteEmail('');
                  setInviteRole('viewer');
                }}
              >
                Annuleren
              </Button>
            </div>
          </div>
          
          <div className="text-sm text-text-muted">
            <p className="font-medium mb-1">Rol uitleg:</p>
            <ul className="space-y-1">
              {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
                <li key={role}>
                  <strong>{ROLE_LABELS[role as UserRole]}:</strong> {description}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}

      {/* Current Members */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-4">
          Huidige leden ({members.length})
        </h2>
        
        <div className="space-y-4">
          {members.map((member) => {
            const RoleIcon = ROLE_ICONS[member.role];
            const isCurrentUser = member.id === user?.id;
            const canEditMember = canInviteMembers && !isCurrentUser;
            
            return (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-bg-muted flex items-center justify-center overflow-hidden">
                    {member.avatar ? (
                      <img
                        src={member.avatar}
                        alt={member.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-medium text-text-primary">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    )}
                  </div>
                  
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-text-heading">
                        {member.name}
                      </h3>
                      {isCurrentUser && (
                        <Badge variant="secondary" className="text-xs">
                          Jij
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-text-muted">
                      {member.email}
                    </p>
                    <p className="text-xs text-text-muted">
                      Lid sinds {formatDate(member.joinedAt)}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <RoleIcon size={16} className="text-text-muted" />
                    {canEditMember ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => handleChangeRole(member.id, value as UserRole)}
                      >
                        <option value="viewer">Kijker</option>
                        <option value="editor">Editor</option>
                        <option value="admin">Beheerder</option>
                        {user?.role === 'owner' && (
                          <option value="owner">Eigenaar</option>
                        )}
                      </Select>
                    ) : (
                      <span className="text-sm font-medium text-text-primary">
                        {ROLE_LABELS[member.role]}
                      </span>
                    )}
                  </div>
                  
                  {canEditMember && member.role !== 'owner' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveMember(member.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 size={16} />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Pending Invites */}
      {pendingInvites.length > 0 && (
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-heading mb-4">
            Uitstaande uitnodigingen ({pendingInvites.length})
          </h2>
          
          <div className="space-y-4">
            {pendingInvites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between p-4 border border-border rounded-lg bg-amber-50/50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Clock size={20} className="text-amber-600" />
                  </div>
                  
                  <div>
                    <h3 className="font-medium text-text-heading">
                      {invite.email}
                    </h3>
                    <p className="text-sm text-text-muted">
                      Uitgenodigd door {invite.invitedBy} op {formatDate(invite.invitedAt)}
                    </p>
                    <p className="text-xs text-text-muted">
                      Verloopt op {formatDate(invite.expiresAt)}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">
                    {ROLE_LABELS[invite.role]}
                  </Badge>
                  
                  {canInviteMembers && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevokeInvite(invite.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Intrekken
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}