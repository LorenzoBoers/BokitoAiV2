/**
 * Embeddable Bokito widget loader for external sites.
 * Usage: <script src="https://cdn.bokito.ai/widget.js" data-tenant="your-slug"></script>
 */
;(function () {
  const script = document.currentScript as HTMLScriptElement | null
  const tenant = script?.dataset.tenant
  if (!tenant) return
  const apiBase = script?.dataset.api || 'https://api.bokito.ai'
  const container = document.createElement('div')
  container.id = 'bokito-widget-root'
  document.body.appendChild(container)
  fetch(`${apiBase}/api/widget/${tenant}/session`, { method: 'POST' })
    .then((r) => r.json())
    .then((data) => {
      const btn = document.createElement('button')
      btn.textContent = data.appearance?.chatbot_name || 'Chat'
      btn.style.cssText = `position:fixed;bottom:20px;right:20px;background:${data.appearance?.main_color || '#00FF99'};border:none;border-radius:24px;padding:12px 20px;cursor:pointer;z-index:99999`
      btn.onclick = () => window.open(`${apiBase.replace('api.', '')}/messenger`, '_blank')
      container.appendChild(btn)
      if (data.powered_by !== false) {
        const powered = document.createElement('div')
        powered.textContent = 'powered by Bokito'
        powered.style.cssText = 'position:fixed;bottom:8px;right:20px;font-size:10px;color:#888;z-index:99999'
        container.appendChild(powered)
      }
    })
    .catch(console.error)
})()
