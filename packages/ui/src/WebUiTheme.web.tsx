import { useEffect, useState, type ReactNode } from 'react'
import { UiThemeProvider } from './theme'

function readScheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

export function WebUiTheme({ children }: { children: ReactNode }) {
  const [scheme, setScheme] = useState<'light' | 'dark'>(readScheme)
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setScheme(readScheme())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return <UiThemeProvider scheme={scheme}>{children}</UiThemeProvider>
}
