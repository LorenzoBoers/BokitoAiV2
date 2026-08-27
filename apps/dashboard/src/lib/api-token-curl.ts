/** Example GET for a newly created workspace token. */
export function buildApiTokenCurl(token: string, origin = ''): string {
  const base = origin.replace(/\/$/, '')
  return `curl -sS "${base}/api/public/v1/signals" -H "Authorization: Bearer ${token}"`
}
