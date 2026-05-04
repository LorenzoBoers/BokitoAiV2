import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  User, 
  Clock, 
  MessageSquare, 
  Plus, 
  Send,
  Edit3,
  Trash2,
  AtSign,
  Bold,
  Link,
  List,
} from 'lucide-react';
import { useDatabase } from '../../context/DatabaseContext';
import type { CustomRecord, CustomField, RecordActivity, RecordComment, WorkspaceUser } from '../../types/custom-db';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import * as api from '../../lib/custom-db-api';

interface RecordDrawerProps {
  record: CustomRecord;
  fields: CustomField[];
  onClose: () => void;
  onUpdate?: (data: Record<string, unknown>) => void;
}

interface ActivityLogProps {
  recordId: number;
}

interface CommentThreadProps {
  recordId: number;
  workspaceUsers: WorkspaceUser[];
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 1) return 'Zojuist';
  if (diffMinutes < 60) return `${diffMinutes} min geleden`;
  if (diffHours < 24) return `${diffHours} uur geleden`;
  if (diffDays < 7) return `${diffDays} dagen geleden`;
  
  return date.toLocaleDateString('nl-NL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ActivityLog({ recordId }: ActivityLogProps) {
  const [activities, setActivities] = useState<RecordActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [newNote, setNewNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const loadActivities = useCallback(async () => {
    try {
      const data = await api.listRecordActivity(recordId);
      setActivities(data || []);
    } catch (error) {
      console.error('Failed to load activities:', error);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;
    
    setAddingNote(true);
    try {
      await api.addRecordNote(recordId, newNote.trim());
      setNewNote('');
      await loadActivities();
    } catch (error) {
      console.error('Failed to add note:', error);
    } finally {
      setAddingNote(false);
    }
  };

  const renderActivityItem = (activity: RecordActivity) => {
    let description = '';
    let icon = <Clock size={14} className="text-text-muted" />;

    switch (activity.action) {
      case 'created':
        description = 'Record aangemaakt';
        break;
      case 'updated':
        if (activity.field_slug) {
          description = `Veld "${activity.field_slug}" bijgewerkt`;
          if (activity.old_value !== undefined && activity.new_value !== undefined) {
            description += ` van "${activity.old_value}" naar "${activity.new_value}"`;
          }
        } else {
          description = 'Record bijgewerkt';
        }
        break;
      case 'note':
        description = activity.note || 'Notitie toegevoegd';
        icon = <MessageSquare size={14} className="text-accent" />;
        break;
      default:
        description = `Actie: ${activity.action}`;
    }

    return (
      <div key={activity.id} className="flex gap-3 py-2">
        <div className="w-6 h-6 rounded-full bg-bg-hover flex items-center justify-center flex-shrink-0 mt-0.5">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-text-secondary">
            <span className="font-medium text-text-primary">
              {activity.user_name || 'Systeem'}
            </span>
            {' '}
            {description}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {formatDateTime(activity.created_at)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-text-heading">Activiteit</h4>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => setNewNote(newNote ? '' : 'Nieuwe notitie...')}
        >
          <Plus size={12} className="mr-1" />
          Notitie
        </Button>
      </div>

      {newNote && (
        <div className="space-y-2 p-3 rounded-lg border border-border bg-bg-subtle">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Voeg een notitie toe..."
            className="w-full min-h-[60px] p-2 text-xs border border-border rounded-md bg-bg-elevated resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setNewNote('')}
              className="h-7 px-2 text-xs"
            >
              Annuleren
            </Button>
            <Button
              size="sm"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
              className="h-7 px-2 text-xs"
            >
              {addingNote ? 'Bezig...' : 'Opslaan'}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-1 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted text-center py-4">
            Activiteiten laden...
          </div>
        ) : activities.length === 0 ? (
          <div className="text-xs text-text-muted text-center py-4">
            Nog geen activiteiten
          </div>
        ) : (
          activities.map(renderActivityItem)
        )}
      </div>
    </div>
  );
}

function CommentThread({ recordId, workspaceUsers }: CommentThreadProps) {
  const [comments, setComments] = useState<RecordComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const loadComments = useCallback(async () => {
    try {
      const data = await api.listRecordComments(recordId);
      setComments(data || []);
    } catch (error) {
      console.error('Failed to load comments:', error);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    
    setAddingComment(true);
    try {
      // Extract mentions from content (simple @username pattern)
      const mentionMatches = newComment.match(/@(\w+)/g) || [];
      const mentions = mentionMatches
        .map(mention => workspaceUsers.find(u => u.name.toLowerCase().includes(mention.slice(1).toLowerCase())))
        .filter(Boolean)
        .map(user => user!.id);

      await api.addRecordComment(recordId, {
        content: newComment.trim(),
        parent_id: replyTo || undefined,
        mentions: mentions.length > 0 ? mentions : undefined,
      });
      
      setNewComment('');
      setReplyTo(null);
      await loadComments();
    } catch (error) {
      console.error('Failed to add comment:', error);
    } finally {
      setAddingComment(false);
    }
  };

  const handleEditComment = async (commentId: number) => {
    if (!editContent.trim()) return;
    
    try {
      await api.updateRecordComment(commentId, editContent.trim());
      setEditingComment(null);
      setEditContent('');
      await loadComments();
    } catch (error) {
      console.error('Failed to edit comment:', error);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!confirm('Weet je zeker dat je deze reactie wilt verwijderen?')) return;
    
    try {
      await api.deleteRecordComment(commentId);
      await loadComments();
    } catch (error) {
      console.error('Failed to delete comment:', error);
    }
  };

  const renderComment = (comment: RecordComment) => {
    const isEditing = editingComment === comment.id;
    const replies = comments.filter(c => c.parent_id === comment.id);

    return (
      <div key={comment.id} className="space-y-2">
        <div className="flex gap-3">
          <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 text-white text-xs font-bold">
            {comment.user_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-text-primary">
                {comment.user_name || 'Onbekend'}
              </span>
              <span className="text-xs text-text-muted">
                {formatDateTime(comment.created_at)}
              </span>
              {comment.updated_at && comment.updated_at !== comment.created_at && (
                <span className="text-xs text-text-muted">(bewerkt)</span>
              )}
            </div>
            
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full min-h-[60px] p-2 text-xs border border-border rounded-md bg-bg-elevated resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingComment(null);
                      setEditContent('');
                    }}
                    className="h-6 px-2 text-xs"
                  >
                    Annuleren
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleEditComment(comment.id)}
                    className="h-6 px-2 text-xs"
                  >
                    Opslaan
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs text-text-secondary whitespace-pre-wrap">
                  {comment.content}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    type="button"
                    onClick={() => setReplyTo(comment.id)}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Reageren
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingComment(comment.id);
                      setEditContent(comment.content);
                    }}
                    className="text-xs text-text-muted hover:text-text-primary"
                  >
                    Bewerken
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteComment(comment.id)}
                    className="text-xs text-status-error hover:text-status-error/80"
                  >
                    Verwijderen
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {replies.length > 0 && (
          <div className="ml-9 space-y-2 border-l border-border pl-3">
            {replies.map(reply => renderComment(reply))}
          </div>
        )}
      </div>
    );
  };

  const topLevelComments = comments.filter(c => !c.parent_id);

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-medium text-text-heading">Reacties</h4>

      <div className="space-y-3 p-3 rounded-lg border border-border bg-bg-subtle">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder={replyTo ? "Schrijf een reactie..." : "Voeg een reactie toe..."}
          className="w-full min-h-[80px] p-2 text-xs border border-border rounded-md bg-bg-elevated resize-none focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <AtSign size={12} />
            <span>Gebruik @naam om iemand te vermelden</span>
          </div>
          
          <div className="flex gap-2">
            {replyTo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setReplyTo(null)}
                className="h-7 px-2 text-xs"
              >
                Annuleren
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleAddComment}
              disabled={!newComment.trim() || addingComment}
              className="h-7 px-2 text-xs"
            >
              <Send size={12} className="mr-1" />
              {addingComment ? 'Bezig...' : 'Versturen'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 max-h-96 overflow-y-auto">
        {loading ? (
          <div className="text-xs text-text-muted text-center py-4">
            Reacties laden...
          </div>
        ) : topLevelComments.length === 0 ? (
          <div className="text-xs text-text-muted text-center py-4">
            Nog geen reacties
          </div>
        ) : (
          topLevelComments.map(renderComment)
        )}
      </div>
    </div>
  );
}

function OwnerAssignment({ record, onUpdate }: { record: CustomRecord; onUpdate?: (data: Record<string, unknown>) => void }) {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await api.listWorkspaceUsers();
        setUsers(data || []);
      } catch (error) {
        console.error('Failed to load users:', error);
      } finally {
        setLoading(false);
      }
    };
    
    void loadUsers();
  }, []);

  const handleAssignOwner = async (userId: number | null) => {
    setUpdating(true);
    try {
      const updateData = { owner_id: userId };
      await onUpdate?.(updateData);
    } catch (error) {
      console.error('Failed to update owner:', error);
    } finally {
      setUpdating(false);
    }
  };

  const currentOwner = users.find(u => u.id === record.owner_id);

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-heading">Eigenaar</h4>
      
      <div className="flex items-center gap-2">
        {currentOwner ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-white text-xs font-bold">
              {currentOwner.name.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-text-primary">{currentOwner.name}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-text-muted">
            <User size={16} />
            <span className="text-xs">Niet toegewezen</span>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <select
          value={record.owner_id || ''}
          onChange={(e) => handleAssignOwner(e.target.value ? Number(e.target.value) : null)}
          disabled={loading || updating}
          className="w-full p-2 text-xs border border-border rounded-md bg-bg-elevated focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="">Niet toegewezen</option>
          {users.map(user => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        
        <Button
          size="sm"
          variant="ghost"
          onClick={() => handleAssignOwner(1)} // Assuming current user ID is 1
          disabled={updating}
          className="h-7 px-2 text-xs w-full"
        >
          <User size={12} className="mr-1" />
          Aan mij toewijzen
        </Button>
      </div>
    </div>
  );
}

export default function RecordDrawer({ record, fields, onClose, onUpdate }: RecordDrawerProps) {
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const data = await api.listWorkspaceUsers();
        setWorkspaceUsers(data || []);
      } catch (error) {
        console.error('Failed to load workspace users:', error);
      }
    };
    
    void loadUsers();
  }, []);

  const getTitleField = () => {
    const titleField = fields.find(f => f.field_type === 'text' && f.position === 0);
    if (titleField && record.data[titleField.slug]) {
      return String(record.data[titleField.slug]);
    }
    return `Record #${record.id}`;
  };

  const drawer = (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[1px] flex">
      <div className="ml-auto w-full max-w-md h-full bg-bg-elevated border-l border-border flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h3 className="text-sm font-semibold text-text-heading truncate">
              {getTitleField()}
            </h3>
            <p className="text-xs text-text-muted">
              Record #{record.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Owner Assignment */}
          <OwnerAssignment record={record} onUpdate={onUpdate} />
          
          {/* Activity Log */}
          <ActivityLog recordId={record.id} />
          
          {/* Comment Thread */}
          <CommentThread recordId={record.id} workspaceUsers={workspaceUsers} />
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(drawer, document.body) : drawer;
}