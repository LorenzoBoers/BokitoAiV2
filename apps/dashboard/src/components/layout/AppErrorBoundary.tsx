import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../../i18n'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App error boundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-bg-primary p-6">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-lg font-semibold text-text-heading">
              {i18n.t('errorBoundary.title', { ns: 'nav' })}
            </h1>
            <p className="text-sm text-text-muted">
              {i18n.t('errorBoundary.body', { ns: 'nav' })}
            </p>
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
              onClick={() => window.location.reload()}
            >
              {i18n.t('errorBoundary.refresh', { ns: 'nav' })}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
