import { Component, type ErrorInfo, type ReactNode } from 'react'
import i18n from '../../i18n'
import { Button } from '../ui/button'
import { PageHeader } from '../ui/page-header'

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
            <PageHeader
              className="mb-0 justify-center text-center"
              title={i18n.t('errorBoundary.title', { ns: 'nav' })}
              subtitle={i18n.t('errorBoundary.body', { ns: 'nav' })}
            />
            <Button
              type="button"
              onClick={() => window.location.reload()}
            >
              {i18n.t('errorBoundary.refresh', { ns: 'nav' })}
            </Button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
