/**
 * Passthrough for app.bokito.ai so traffic follows zone DNS (bokitoapp-prod CNAME)
 * instead of the wildcard tenant router (*.bokito.ai/*) which may hardcode widget-prod.
 */
export default {
  async fetch(request) {
    return fetch(request)
  },
}
