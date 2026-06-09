import { useState } from 'react';
import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useApi } from '../../context/ApiContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface ChartBarProps {
  date: string;
  readRequests: number;
  writeRequests: number;
  errors: number;
  maxValue: number;
}

function ChartBar({ date, readRequests, writeRequests, errors, maxValue }: ChartBarProps) {
  const totalRequests = readRequests + writeRequests;
  const readHeight = maxValue > 0 ? (readRequests / maxValue) * 100 : 0;
  const writeHeight = maxValue > 0 ? (writeRequests / maxValue) * 100 : 0;
  const errorRate = totalRequests > 0 ? (errors / totalRequests) * 100 : 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('nl-NL', { 
      month: 'short', 
      day: 'numeric' 
    });
  };

  return (
    <div className="flex flex-col items-center space-y-1 group">
      <div className="relative h-32 w-8 bg-bg-subtle rounded-sm overflow-hidden">
        {/* Write requests (green) */}
        <div
          className="absolute bottom-0 w-full bg-green-500 transition-all duration-200"
          style={{ height: `${writeHeight}%` }}
        />
        {/* Read requests (blue) stacked on top */}
        <div
          className="absolute w-full bg-blue-500 transition-all duration-200"
          style={{ 
            height: `${readHeight}%`,
            bottom: `${writeHeight}%`
          }}
        />
        {/* Error indicator */}
        {errors > 0 && (
          <div className="absolute top-0 w-full h-1 bg-red-500" />
        )}
      </div>
      
      <div className="text-xs text-text-muted text-center">
        {formatDate(date)}
      </div>

      {/* Tooltip on hover */}
      <div className="invisible group-hover:visible absolute z-10 bg-bg-elevated border border-border rounded-lg shadow-lg p-3 text-sm -mt-20 whitespace-nowrap">
        <div className="font-medium text-text-heading mb-2">{formatDate(date)}</div>
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-blue-500 rounded-sm" />
            <span>Lezen: {readRequests.toLocaleString()}</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded-sm" />
            <span>Schrijven: {writeRequests.toLocaleString()}</span>
          </div>
          {errors > 0 && (
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-sm" />
              <span>Errors: {errors} ({errorRate.toFixed(1)}%)</span>
            </div>
          )}
          <div className="pt-1 border-t border-border">
            <span className="font-medium">Totaal: {totalRequests.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatsCardProps {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  icon: React.ReactNode;
}

function StatsCard({ title, value, change, changeLabel, icon }: StatsCardProps) {
  const getTrendIcon = () => {
    if (change > 0) return <TrendingUp size={16} className="text-green-600" />;
    if (change < 0) return <TrendingDown size={16} className="text-red-600" />;
    return <Minus size={16} className="text-text-muted" />;
  };

  const getTrendColor = () => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-text-muted';
  };

  return (
    <div className="bg-bg border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {icon}
          <span className="text-sm font-medium text-text-secondary">{title}</span>
        </div>
        <div className="flex items-center space-x-1">
          {getTrendIcon()}
          <span className={`text-sm font-medium ${getTrendColor()}`}>
            {change > 0 ? '+' : ''}{change}%
          </span>
        </div>
      </div>
      <div className="mt-2">
        <div className="text-2xl font-semibold text-text-heading">{value}</div>
        <div className="text-sm text-text-muted">{changeLabel}</div>
      </div>
    </div>
  );
}

export default function UsageChart() {
  const { apiKeys, usageStats } = useApi();
  const [selectedKeyId, setSelectedKeyId] = useState<string>(apiKeys[0]?.id || '');

  if (apiKeys.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 mx-auto mb-4 bg-bg-subtle rounded-lg flex items-center justify-center">
          <BarChart3 size={24} className="text-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-text-heading mb-2">No API keys</h3>
        <p className="text-text-secondary">
          Maak eerst API sleutels aan om gebruik statistieken te bekijken
        </p>
      </div>
    );
  }

  const selectedKey = apiKeys.find(key => key.id === selectedKeyId);
  const stats = usageStats[selectedKeyId] || [];
  
  // Calculate statistics
  const totalReadRequests = stats.reduce((sum, day) => sum + day.readRequests, 0);
  const totalWriteRequests = stats.reduce((sum, day) => sum + day.writeRequests, 0);
  const totalErrors = stats.reduce((sum, day) => sum + day.errors, 0);
  const totalRequests = totalReadRequests + totalWriteRequests;

  // Calculate trends (last 7 days vs previous 7 days)
  const last7Days = stats.slice(-7);
  const previous7Days = stats.slice(-14, -7);
  
  const last7Total = last7Days.reduce((sum, day) => sum + day.readRequests + day.writeRequests, 0);
  const previous7Total = previous7Days.reduce((sum, day) => sum + day.readRequests + day.writeRequests, 0);
  
  const requestsTrend = previous7Total > 0 ? ((last7Total - previous7Total) / previous7Total) * 100 : 0;

  const last7Errors = last7Days.reduce((sum, day) => sum + day.errors, 0);
  const previous7Errors = previous7Days.reduce((sum, day) => sum + day.errors, 0);
  
  const errorsTrend = previous7Errors > 0 ? ((last7Errors - previous7Errors) / previous7Errors) * 100 : 0;

  // Find max value for chart scaling
  const maxDailyRequests = Math.max(...stats.map(day => day.readRequests + day.writeRequests));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-heading">API Gebruik</h2>
          <p className="text-sm text-text-secondary">
            Dagelijkse statistieken van de laatste 30 dagen
          </p>
        </div>
        
        {apiKeys.length > 1 && (
          <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {apiKeys.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  <div className="flex items-center space-x-2">
                    <span>{key.name}</span>
                    <span className="text-text-muted font-mono text-xs">{key.maskedKey}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatsCard
          title="Totaal Requests"
          value={totalRequests.toLocaleString()}
          change={Math.round(requestsTrend)}
          changeLabel="vs vorige week"
          icon={<BarChart3 size={20} className="text-blue-600" />}
        />
        <StatsCard
          title="Lees Requests"
          value={totalReadRequests.toLocaleString()}
          change={0}
          changeLabel="laatste 30 dagen"
          icon={<div className="w-5 h-5 bg-blue-500 rounded-sm" />}
        />
        <StatsCard
          title="Schrijf Requests"
          value={totalWriteRequests.toLocaleString()}
          change={0}
          changeLabel="laatste 30 dagen"
          icon={<div className="w-5 h-5 bg-green-500 rounded-sm" />}
        />
        <StatsCard
          title="Errors"
          value={totalErrors.toString()}
          change={Math.round(errorsTrend)}
          changeLabel="vs vorige week"
          icon={<div className="w-5 h-5 bg-red-500 rounded-sm" />}
        />
      </div>

      {/* Chart */}
      <div className="bg-bg border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-medium text-text-heading">
            Dagelijks Gebruik - {selectedKey?.name}
          </h3>
          <div className="flex items-center space-x-4 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-blue-500 rounded-sm" />
              <span className="text-text-secondary">Lezen</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-sm" />
              <span className="text-text-secondary">Schrijven</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-sm" />
              <span className="text-text-secondary">Errors</span>
            </div>
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="text-center py-12">
            <BarChart3 size={48} className="mx-auto text-text-muted mb-4" />
            <p className="text-text-secondary">No usage data available yet</p>
          </div>
        ) : (
          <div className="flex items-end justify-between space-x-1 h-40">
            {stats.map((day) => (
              <ChartBar
                key={day.date}
                date={day.date}
                readRequests={day.readRequests}
                writeRequests={day.writeRequests}
                errors={day.errors}
                maxValue={maxDailyRequests}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}