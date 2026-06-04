/** True when the dashboard proxies API calls to the FastAPI backend (local AI OS). */
export function isBokitoMode(): boolean {
  return import.meta.env.VITE_API_MODE === 'bokito'
}
