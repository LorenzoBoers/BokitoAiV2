# Cron: decision_unsnooze_hourly

Schedule: every hour at :00.

SQL predicate:

```sql
UPDATE messages
SET resolved_at = NULL
WHERE message_type = 'decision_request'
  AND status = 'awaiting_human'
  AND resolved_at IS NOT NULL
  AND resolved_at <= NOW();
```

Update Expo push trigger on `messages` insert to skip when `resolved_at > NOW()`.
