import { Component, type ErrorInfo, type ReactNode } from 'react'

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
            <h1 className="text-lg font-semibold text-text-heading">Something went wrong</h1>
            <p className="text-sm text-text-muted">
              An unexpected error occurred. Refresh the page or try again later.
            </p>
            <button
              type="button"
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white"
              onClick={() => window.location.reload()}
            >
              Refresh page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
