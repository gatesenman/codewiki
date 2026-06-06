import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props { children: ReactNode; fallbackMessage?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="max-w-lg text-center space-y-4">
          <div className="text-4xl">&#x26A0;</div>
          <h2 className="text-lg font-semibold text-red-400">
            {this.props.fallbackMessage || 'Something went wrong'}
          </h2>
          <pre className="text-xs text-gray-400 bg-gray-900 p-3 rounded overflow-auto max-h-40 text-left">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }
}
