import React, { useState } from 'react';
import { Download, Filter, Calendar, User, Activity, Search } from 'lucide-react';
import { usePermission } from '../hooks/usePermission';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Select } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { AuditLogEntry, AuditActionType } from '../types/custom-db';

const ACTION_TYPE_LABELS: Record<AuditActionType, string> = {
  record_create: 'Record aangemaakt',
  record_update: 'Record bijgewerkt',
  record_delete: 'Record verwijderd',
  schema_change: 'Schema gewijzigd',
  api_key_create: 'API key aangemaakt',
  api_key_revoke: 'API key ingetrokken',
  role_change: 'Rol gewijzigd',
  login: 'Ingelogd',
};

const ACTION_TYPE_COLORS: Record<AuditActionType, string> = {
  record_create: 'bg-green-100 text-green-800',
  record_update: 'bg-blue-100 text-blue-800',
  record_delete: 'bg-red-100 text-red-800',
  schema_change: 'bg-purple-100 text-purple-800',
  api_key_create: 'bg-orange-100 text-orange-800',
  api_key_revoke: 'bg-red-100 text-red-800',
  role_change: 'bg-yellow-100 text-yellow-800',
  login: 'bg-gray-100 text-gray-800',
};

// Mock audit log data
const mockAuditLogs: AuditLogEntry[] = [
  {
    id: 1,
    timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), // 15 min ago
    userId: 1,
    userName: 'Sarah van der Berg',
    userAvatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=32&h=32&fit=crop&crop=face',
    actionType: 'record_create',
    tableName: 'klanten',
    recordId: 123,
    details: 'Nieuwe klant "Acme Corp" toegevoegd',
  },
  {
    id: 2,
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), // 45 min ago
    userId: 2,
    userName: 'Mark Jansen',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face',
    actionType: 'record_update',
    tableName: 'projecten',
    recordId: 456,
    changedFields: [
      { field: 'status', oldValue: 'In uitvoering', newValue: 'Afgerond' },
      { field: 'einddatum', oldValue: null, newValue: '2024-03-15' },
    ],
    details: 'Project status bijgewerkt naar "Afgerond"',
  },
  {
    id: 3,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
    userId: 3,
    userName: 'Lisa de Wit',
    userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=32&h=32&fit=crop&crop=face',
    actionType: 'schema_change',
    tableName: 'leads',
    details: 'Nieuw veld "bron" toegevoegd aan tabel',
  },
  {
    id: 4,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), // 4 hours ago
    userId: 1,
    userName: 'Sarah van der Berg',
    userAvatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b786?w=32&h=32&fit=crop&crop=face',
    actionType: 'role_change',
    details: 'Tom Bakker rol gewijzigd van "Editor" naar "Viewer"',
  },
  {
    id: 5,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), // 6 hours ago
    userId: 2,
    userName: 'Mark Jansen',
    userAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=32&h=32&fit=crop&crop=face',
    actionType: 'api_key_create',
    details: 'Nieuwe API key "Zapier Integration" aangemaakt',
  },
  {
    id: 6,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), // 8 hours ago
    userId: 4,
    userName: 'Tom Bakker',
    actionType: 'login',
    details: 'Ingelogd vanaf IP 192.168.1.100',
  },
  {
    id: 7,
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(), // 12 hours ago
    userId: 3,
    userName: 'Lisa de Wit',
    userAvatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=32&h=32&fit=crop&crop=face',
    actionType: 'record_delete',
    tableName: 'leads',
    recordId: 789,
    details: 'Lead "Oude prospect" verwijderd',
  },
];

export default function AuditLog() {
  const canViewAuditLog = usePermission('view_audit_log');
  
  const [auditLogs] = useState<AuditLogEntry[]>(mockAuditLogs);
  const [filteredLogs, setFilteredLogs] = useState<AuditLogEntry[]>(mockAuditLogs);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedActionType, setSelectedActionType] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Get unique users for filter
  const uniqueUsers = Array.from(new Set(auditLogs.map(log => log.userName)));

  // Apply filters
  React.useEffect(() => {
    let filtered = auditLogs;

    if (searchTerm) {
      filtered = filtered.filter(log =>
        log.details.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.tableName?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedUser) {
      filtered = filtered.filter(log => log.userName === selectedUser);
    }

    if (selectedActionType) {
      filtered = filtered.filter(log => log.actionType === selectedActionType);
    }

    if (dateFrom) {
      filtered = filtered.filter(log => 
        new Date(log.timestamp) >= new Date(dateFrom)
      );
    }

    if (dateTo) {
      filtered = filtered.filter(log => 
        new Date(log.timestamp) <= new Date(dateTo + 'T23:59:59')
      );
    }

    setFilteredLogs(filtered);
  }, [auditLogs, searchTerm, selectedUser, selectedActionType, dateFrom, dateTo]);

  const handleExportCSV = () => {
    const csvContent = [
      ['Timestamp', 'User', 'Action', 'Table', 'Record ID', 'Details'].join(','),
      ...filteredLogs.map(log => [
        log.timestamp,
        log.userName,
        ACTION_TYPE_LABELS[log.actionType],
        log.tableName || '',
        log.recordId || '',
        `"${log.details}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('nl-NL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!canViewAuditLog) {
    return (
      <div className="max-w-4xl mx-auto">
        <Card className="p-8 text-center">
          <h1 className="text-xl font-semibold text-text-heading mb-2">
            Geen toegang
          </h1>
          <p className="text-text-muted">
            Je hebt geen toestemming om de audit log te bekijken.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-heading mb-2">
            Audit log
          </h1>
          <p className="text-text-muted">
            Overzicht van alle activiteiten in je workspace (90 dagen bewaard)
          </p>
        </div>
        
        <Button onClick={handleExportCSV} variant="secondary">
          <Download size={16} />
          Exporteren als CSV
        </Button>
      </div>

      {/* Retention Notice */}
      <Card className="p-4 bg-blue-50/50 border-blue-200">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
            <Calendar size={16} className="text-blue-600" />
          </div>
          <div>
            <h3 className="font-medium text-blue-900">
              90 dagen bewaarperiode
            </h3>
            <p className="text-sm text-blue-700">
              Audit logs worden 90 dagen bewaard. Oudere logs worden automatisch verwijderd.
            </p>
          </div>
        </div>
      </Card>

      {/* Filters */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Filter size={16} className="text-text-muted" />
          <h2 className="font-medium text-text-heading">Filters</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Zoeken
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Zoek in details..."
                className="pl-9"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Gebruiker
            </label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <option value="">Alle gebruikers</option>
              {uniqueUsers.map(user => (
                <option key={user} value={user}>{user}</option>
              ))}
            </Select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Actie type
            </label>
            <Select value={selectedActionType} onValueChange={setSelectedActionType}>
              <option value="">Alle acties</option>
              {Object.entries(ACTION_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>{label}</option>
              ))}
            </Select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Van datum
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Tot datum
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
        
        {(searchTerm || selectedUser || selectedActionType || dateFrom || dateTo) && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
            <p className="text-sm text-text-muted">
              {filteredLogs.length} van {auditLogs.length} logs getoond
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchTerm('');
                setSelectedUser('');
                setSelectedActionType('');
                setDateFrom('');
                setDateTo('');
              }}
            >
              Filters wissen
            </Button>
          </div>
        )}
      </Card>

      {/* Audit Log Entries */}
      <Card className="p-6">
        <div className="space-y-4">
          {filteredLogs.length === 0 ? (
            <div className="text-center py-8">
              <Activity size={48} className="mx-auto text-text-muted mb-4" />
              <h3 className="font-medium text-text-heading mb-2">
                Geen logs gevonden
              </h3>
              <p className="text-text-muted">
                Probeer andere filters of zoektermen.
              </p>
            </div>
          ) : (
            filteredLogs.map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-4 p-4 border border-border rounded-lg hover:bg-bg-muted/30 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                  {log.userAvatar ? (
                    <img
                      src={log.userAvatar}
                      alt={log.userName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User size={20} className="text-text-muted" />
                  )}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <Badge className={ACTION_TYPE_COLORS[log.actionType]}>
                      {ACTION_TYPE_LABELS[log.actionType]}
                    </Badge>
                    
                    {log.tableName && (
                      <Badge variant="secondary">
                        {log.tableName}
                      </Badge>
                    )}
                    
                    <span className="text-xs text-text-muted">
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  
                  <p className="text-sm text-text-primary mb-2">
                    <strong>{log.userName}</strong> - {log.details}
                  </p>
                  
                  {log.changedFields && log.changedFields.length > 0 && (
                    <div className="text-xs text-text-muted space-y-1">
                      {log.changedFields.map((change, index) => (
                        <div key={index} className="font-mono bg-bg-muted px-2 py-1 rounded">
                          <strong>{change.field}:</strong>{' '}
                          <span className="text-red-600">
                            {change.oldValue?.toString() || '(leeg)'}
                          </span>
                          {' → '}
                          <span className="text-green-600">
                            {change.newValue?.toString() || '(leeg)'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}