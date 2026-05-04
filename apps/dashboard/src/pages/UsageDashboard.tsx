import React from 'react';
import { Database, Zap, HardDrive, Webhook, TrendingUp, AlertCircle } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { UsageStats } from '../types/custom-db';

// Mock usage data
const mockUsageStats: UsageStats = {
  totalRecords: 2340,
  recordsByTable: [
    { tableName: 'Klanten', count: 856 },
    { tableName: 'Projecten', count: 432 },
    { tableName: 'Leads', count: 678 },
    { tableName: 'Facturen', count: 234 },
    { tableName: 'Taken', count: 140 },
  ],
  apiCallsLast30Days: 15420,
  apiCallsHistory: [
    { date: '2024-02-15', count: 420 },
    { date: '2024-02-16', count: 380 },
    { date: '2024-02-17', count: 520 },
    { date: '2024-02-18', count: 340 },
    { date: '2024-02-19', count: 680 },
    { date: '2024-02-20', count: 720 },
    { date: '2024-02-21', count: 590 },
    { date: '2024-02-22', count: 450 },
    { date: '2024-02-23', count: 620 },
    { date: '2024-02-24', count: 580 },
    { date: '2024-02-25', count: 490 },
    { date: '2024-02-26', count: 380 },
    { date: '2024-02-27', count: 420 },
    { date: '2024-02-28', count: 560 },
    { date: '2024-03-01', count: 640 },
    { date: '2024-03-02', count: 720 },
    { date: '2024-03-03', count: 580 },
    { date: '2024-03-04', count: 490 },
    { date: '2024-03-05', count: 620 },
    { date: '2024-03-06', count: 540 },
    { date: '2024-03-07', count: 480 },
    { date: '2024-03-08', count: 390 },
    { date: '2024-03-09', count: 450 },
    { date: '2024-03-10', count: 520 },
    { date: '2024-03-11', count: 680 },
    { date: '2024-03-12', count: 590 },
    { date: '2024-03-13', count: 420 },
    { date: '2024-03-14', count: 380 },
    { date: '2024-03-15', count: 520 },
    { date: '2024-03-16', count: 640 },
  ],
  storageUsedMB: 145.7,
  webhookSuccessRate: 96.8,
  planLimits: {
    maxRecords: 10000,
    maxApiCalls: 50000,
    maxStorageMB: 1000,
  },
};

// Simple bar chart component
function SimpleBarChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const maxCount = Math.max(...data.map(d => d.count));
  
  return (
    <div className="h-32 flex items-end gap-1">
      {data.slice(-14).map((item, index) => {
        const height = (item.count / maxCount) * 100;
        const date = new Date(item.date);
        const day = date.getDate();
        
        return (
          <div key={index} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full bg-accent rounded-sm min-h-[2px] transition-all hover:bg-accent-hover"
              style={{ height: `${height}%` }}
              title={`${day}/${date.getMonth() + 1}: ${item.count} calls`}
            />
            <span className="text-xs text-text-muted">
              {day}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function UsageCard({ 
  title, 
  value, 
  limit, 
  icon: Icon, 
  unit = '', 
  color = 'blue',
  description 
}: {
  title: string;
  value: number;
  limit: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  unit?: string;
  color?: 'blue' | 'green' | 'orange' | 'red';
  description: string;
}) {
  const percentage = (value / limit) * 100;
  const isNearLimit = percentage > 80;
  const isOverLimit = percentage > 100;
  
  const colorClasses = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-green-600 bg-green-50',
    orange: 'text-orange-600 bg-orange-50',
    red: 'text-red-600 bg-red-50',
  };

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${colorClasses[color]}`}>
          <Icon size={24} />
        </div>
        {isNearLimit && (
          <AlertCircle size={20} className={isOverLimit ? 'text-red-500' : 'text-orange-500'} />
        )}
      </div>
      
      <h3 className="font-semibold text-text-heading mb-1">
        {title}
      </h3>
      
      <div className="mb-3">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-text-heading">
            {value.toLocaleString('nl-NL')}
          </span>
          {unit && (
            <span className="text-sm text-text-muted">
              {unit}
            </span>
          )}
        </div>
        
        <p className="text-sm text-text-muted">
          van {limit.toLocaleString('nl-NL')}{unit} ({percentage.toFixed(1)}%)
        </p>
      </div>
      
      {/* Progress bar */}
      <div className="w-full bg-bg-muted rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all ${
            isOverLimit ? 'bg-red-500' : isNearLimit ? 'bg-orange-500' : 'bg-accent'
          }`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      
      <p className="text-xs text-text-muted">
        {description}
      </p>
    </Card>
  );
}

export default function UsageDashboard() {
  const stats = mockUsageStats;
  
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-heading mb-2">
          Gebruik & limieten
        </h1>
        <p className="text-text-muted">
          Overzicht van je workspace gebruik en plan limieten
        </p>
      </div>

      {/* Usage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <UsageCard
          title="Records"
          value={stats.totalRecords}
          limit={stats.planLimits.maxRecords}
          icon={Database}
          color="blue"
          description="Totaal aantal records in alle tabellen"
        />
        
        <UsageCard
          title="API Calls"
          value={stats.apiCallsLast30Days}
          limit={stats.planLimits.maxApiCalls}
          icon={Zap}
          color="green"
          description="API calls in de afgelopen 30 dagen"
        />
        
        <UsageCard
          title="Opslag"
          value={Math.round(stats.storageUsedMB)}
          limit={stats.planLimits.maxStorageMB}
          icon={HardDrive}
          unit="MB"
          color="orange"
          description="Gebruikte opslagruimte voor bestanden"
        />
        
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center text-purple-600 bg-purple-50">
              <Webhook size={24} />
            </div>
          </div>
          
          <h3 className="font-semibold text-text-heading mb-1">
            Webhook Success
          </h3>
          
          <div className="mb-3">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-text-heading">
                {stats.webhookSuccessRate}%
              </span>
            </div>
            
            <p className="text-sm text-text-muted">
              Afgelopen 30 dagen
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant={stats.webhookSuccessRate > 95 ? 'default' : 'secondary'}>
              {stats.webhookSuccessRate > 95 ? 'Uitstekend' : 'Goed'}
            </Badge>
          </div>
          
          <p className="text-xs text-text-muted mt-2">
            Percentage succesvol afgeleverde webhooks
          </p>
        </Card>
      </div>

      {/* API Usage Chart */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-text-heading mb-1">
              API gebruik (laatste 14 dagen)
            </h2>
            <p className="text-sm text-text-muted">
              Dagelijkse API calls
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-green-600" />
            <span className="text-sm font-medium text-green-600">
              +12% deze maand
            </span>
          </div>
        </div>
        
        <SimpleBarChart data={stats.apiCallsHistory} />
      </Card>

      {/* Records by Table */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-text-heading mb-6">
          Records per tabel
        </h2>
        
        <div className="space-y-4">
          {stats.recordsByTable.map((table, index) => {
            const percentage = (table.count / stats.totalRecords) * 100;
            
            return (
              <div key={index} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-text-heading">
                      {table.tableName}
                    </span>
                    <span className="text-sm text-text-muted">
                      {table.count.toLocaleString('nl-NL')} ({percentage.toFixed(1)}%)
                    </span>
                  </div>
                  
                  <div className="w-full bg-bg-muted rounded-full h-2">
                    <div
                      className="h-2 bg-accent rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Plan Information */}
      <Card className="p-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-blue-900 mb-2">
              Huidige plan: Professional
            </h2>
            <p className="text-blue-700 mb-4">
              Je gebruikt momenteel {((stats.totalRecords / stats.planLimits.maxRecords) * 100).toFixed(1)}% van je plan limieten.
            </p>
            
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-blue-800">
                  {stats.planLimits.maxRecords.toLocaleString('nl-NL')} records
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-blue-800">
                  {stats.planLimits.maxApiCalls.toLocaleString('nl-NL')} API calls per maand
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-blue-800">
                  {stats.planLimits.maxStorageMB.toLocaleString('nl-NL')} MB opslag
                </span>
              </div>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-900 mb-1">
              €49
            </div>
            <div className="text-sm text-blue-700">
              per maand
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}