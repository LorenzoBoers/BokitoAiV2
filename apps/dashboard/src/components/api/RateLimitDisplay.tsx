import { AlertTriangle, Clock, Zap } from 'lucide-react';
import { useApi } from '../../context/ApiContext';

interface RateLimitCardProps {
  title: string;
  current: number;
  limit: number;
  type: 'read' | 'write';
  resetTime: string;
}

function RateLimitCard({ title, current, limit, type, resetTime }: RateLimitCardProps) {
  const percentage = (current / limit) * 100;
  const isNearLimit = percentage > 80;
  const isAtLimit = percentage >= 100;

  const getProgressColor = () => {
    if (isAtLimit) return 'bg-red-500';
    if (isNearLimit) return 'bg-yellow-500';
    return type === 'read' ? 'bg-blue-500' : 'bg-green-500';
  };

  const getBackgroundColor = () => {
    if (isAtLimit) return 'bg-red-100 dark:bg-red-900/20';
    if (isNearLimit) return 'bg-yellow-100 dark:bg-yellow-900/20';
    return 'bg-bg-subtle';
  };

  const getIcon = () => {
    if (isAtLimit) return <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />;
    if (isNearLimit) return <AlertTriangle size={20} className="text-yellow-600 dark:text-yellow-400" />;
    return type === 'read' ? 
      <Zap size={20} className="text-blue-600 dark:text-blue-400" /> :
      <Zap size={20} className="text-green-600 dark:text-green-400" />;
  };

  const formatResetTime = (resetTimeStr: string) => {
    const resetTime = new Date(resetTimeStr);
    const now = new Date();
    const diffMs = resetTime.getTime() - now.getTime();
    const diffMinutes = Math.ceil(diffMs / (1000 * 60));
    
    if (diffMinutes <= 0) return 'Nu';
    if (diffMinutes === 1) return '1 minuut';
    return `${diffMinutes} minuten`;
  };

  return (
    <div className={`p-4 rounded-lg border border-border ${getBackgroundColor()}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {getIcon()}
          <h3 className="font-medium text-text-heading">{title}</h3>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-text-heading">
            {current}/{limit}
          </div>
          <div className="text-xs text-text-muted">per minuut</div>
        </div>
      </div>
      
      <div className="space-y-2">
        <div className="w-full bg-bg-subtle rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${getProgressColor()}`}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">
            {percentage.toFixed(1)}% gebruikt
          </span>
          <div className="flex items-center space-x-1 text-text-muted">
            <Clock size={12} />
            <span>Reset over {formatResetTime(resetTime)}</span>
          </div>
        </div>
      </div>

      {isAtLimit && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-200">
          Rate limit bereikt. Nieuwe requests worden geweigerd tot de reset.
        </div>
      )}

      {isNearLimit && !isAtLimit && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-800 dark:text-yellow-200">
          Bijna aan rate limit. Overweeg je requests te spreiden.
        </div>
      )}
    </div>
  );
}

export default function RateLimitDisplay() {
  const { apiKeys, rateLimits } = useApi();

  if (apiKeys.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-12 h-12 mx-auto mb-4 bg-bg-subtle rounded-lg flex items-center justify-center">
          <Zap size={24} className="text-text-muted" />
        </div>
        <h3 className="text-lg font-medium text-text-heading mb-2">No API keys</h3>
        <p className="text-text-secondary">
          Maak eerst API sleutels aan om rate limits te bekijken
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-heading mb-1">Rate Limits</h2>
        <p className="text-sm text-text-secondary">
          Huidige API gebruik per sleutel
        </p>
      </div>

      <div className="space-y-6">
        {apiKeys.map((key) => {
          const limits = rateLimits[key.id];
          if (!limits) return null;

          return (
            <div key={key.id} className="space-y-4">
              <div className="flex items-center space-x-3">
                <h3 className="font-medium text-text-heading">{key.name}</h3>
                <span className="text-sm text-text-muted font-mono">{key.maskedKey}</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RateLimitCard
                  title="Lees Requests"
                  current={limits.currentUsage.read}
                  limit={limits.readLimit}
                  type="read"
                  resetTime={limits.resetTime}
                />
                <RateLimitCard
                  title="Schrijf Requests"
                  current={limits.currentUsage.write}
                  limit={limits.writeLimit}
                  type="write"
                  resetTime={limits.resetTime}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-bg-subtle border border-border rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-heading mb-2">Rate Limit Informatie</h3>
        <div className="space-y-2 text-sm text-text-secondary">
          <div>
            <strong>Lees Requests:</strong> 120 per minuut (GET endpoints)
          </div>
          <div>
            <strong>Schrijf Requests:</strong> 60 per minuut (POST, PATCH, DELETE endpoints)
          </div>
          <div>
            <strong>Reset Interval:</strong> Elke minuut op de volle minuut
          </div>
          <div>
            <strong>429 Response:</strong> Bij overschrijding krijg je een 429 status met Retry-After header
          </div>
          <div>
            <strong>Headers:</strong> X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
          </div>
        </div>
      </div>
    </div>
  );
}