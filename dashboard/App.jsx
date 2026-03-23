import React, { useState, useCallback, Component } from 'react'
import Login from './components/Login'
import ApprovalsQueue from './panels/ApprovalsQueue'
import MetricsPanel from './panels/MetricsPanel'
import ActivityFeed from './panels/ActivityFeed'
import PortfolioPanel from './panels/PortfolioPanel'
import SystemSettings from './panels/SystemSettings'
import BillingPanel from './panels/BillingPanel'

export default function App() {
  const [token, setToken] = useState(null)
  const [error, setError] = useState('')
  const [activePanel, setActivePanel] = useState('approvals')
  const [killSwitchEnabled, setKillSwitchEnabled] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleLogin = useCallback(async (password) => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })

      if (!response.ok) {
        throw new Error('Invalid password')
      }

      const data = await response.json()
      setToken(data.token)
      setError('')
    } catch (err) {
      setError(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLogout = useCallback(() => {
    setToken(null)
    setError('')
    setActivePanel('approvals')
  }, [])

  if (!token) {
    return <Login onLogin={handleLogin} error={error} loading={loading} />
  }

  return (
    <div className="kail-container">
      {/* Header */}
      <header className="kail-header">
        <div className="max-w-full mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="kail-logo">KAIL</div>
            <div>
              <h1 className="text-lg font-bold text-[#e8eaed]">Content Agency OS</h1>
              <p className="text-xs text-[#9aa0a6]">Automated Content Creation & Management</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Run Pipeline Button */}
            <RunPipelineButton token={token} killSwitchEnabled={killSwitchEnabled} />

            {/* Kill Switch */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#9aa0a6]">Kill Switch:</span>
              <KillSwitchToggle
                enabled={killSwitchEnabled}
                onChange={setKillSwitchEnabled}
                token={token}
              />
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              className="kail-button-outline text-sm"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-full mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Navigation Sidebar */}
        <nav className="lg:col-span-1">
          <div className="kail-panel sticky top-24">
            <h3 className="text-sm font-bold text-[#9aa0a6] uppercase tracking-wide mb-4">
              Panels
            </h3>
            <div className="space-y-2">
              {[
                { id: 'approvals', label: 'Approvals Queue', icon: '✓' },
                { id: 'metrics', label: 'Metrics', icon: '📊' },
                { id: 'activity', label: 'Activity Feed', icon: '📝' },
                { id: 'portfolio', label: 'Portfolio', icon: '🎯' },
                { id: 'billing', label: 'Billing', icon: '💰' },
                { id: 'settings', label: 'System Settings', icon: '⚙️' },
              ].map((panel) => (
                <button
                  key={panel.id}
                  onClick={() => setActivePanel(panel.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg font-medium transition-all ${
                    activePanel === panel.id
                      ? 'bg-[#1a73e8] text-white'
                      : 'text-[#9aa0a6] hover:bg-[#25292f]'
                  }`}
                >
                  <span className="mr-2">{panel.icon}</span>
                  {panel.label}
                </button>
              ))}
            </div>
          </div>
        </nav>

        {/* Main Content Area */}
        <main className="lg:col-span-4">
          {error && (
            <div className="kail-error mb-6">
              <p className="font-medium">{error}</p>
            </div>
          )}

          <ErrorBoundary key={activePanel}>
            {activePanel === 'approvals' && <ApprovalsQueue token={token} />}
            {activePanel === 'metrics' && <MetricsPanel token={token} />}
            {activePanel === 'activity' && <ActivityFeed token={token} />}
            {activePanel === 'portfolio' && <PortfolioPanel token={token} />}
            {activePanel === 'billing' && <BillingPanel token={token} />}
            {activePanel === 'settings' && (
              <SystemSettings
                token={token}
                killSwitchEnabled={killSwitchEnabled}
                onKillSwitchChange={setKillSwitchEnabled}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="kail-panel text-center py-12">
          <p className="text-xl font-bold text-[#ea4335] mb-2">Panel Error</p>
          <p className="text-[#9aa0a6] mb-4">{this.state.error?.message || 'Something went wrong'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="kail-button-primary"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function RunPipelineButton({ token, killSwitchEnabled }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const runPipeline = async (confirmed = false) => {
    setLoading(true)
    setResult(null)
    try {
      const response = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmed }),
      })

      const data = await response.json()

      if (data.requiresConfirmation) {
        setShowConfirm(true)
        setLoading(false)
        return
      }

      if (response.ok) {
        setResult({ type: 'success', message: `Pipeline running (${data.mode} mode)` })
        setShowConfirm(false)
      } else {
        setResult({ type: 'error', message: data.error })
      }
    } catch (err) {
      setResult({ type: 'error', message: err.message })
    } finally {
      setLoading(false)
      setTimeout(() => setResult(null), 4000)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => runPipeline(false)}
        disabled={loading || killSwitchEnabled}
        className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
          killSwitchEnabled
            ? 'bg-[#25292f] text-[#5f6368] cursor-not-allowed'
            : loading
              ? 'bg-[#1557b0] text-white opacity-70 cursor-wait'
              : 'bg-[#1a73e8] hover:bg-[#1557b0] text-white cursor-pointer'
        }`}
        style={{ border: 'none' }}
      >
        {loading ? 'Running...' : '▶ Run Pipeline'}
      </button>

      {/* Production confirmation modal */}
      {showConfirm && (
        <div className="absolute top-12 right-0 z-50 w-72 bg-[#1a1f26] border border-[#3c4043] rounded-lg shadow-2xl p-4">
          <p className="text-sm font-bold text-[#fbbc04] mb-2">Production Mode</p>
          <p className="text-xs text-[#9aa0a6] mb-3">This will trigger real API calls and incur costs. Are you sure?</p>
          <div className="flex gap-2">
            <button
              onClick={() => runPipeline(true)}
              className="kail-button-success text-xs flex-1"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="kail-button-outline text-xs flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result toast */}
      {result && (
        <div className={`absolute top-12 right-0 z-50 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap ${
          result.type === 'success'
            ? 'bg-[#34a853] bg-opacity-20 text-[#81c995] border border-[#34a853] border-opacity-50'
            : 'bg-[#ea4335] bg-opacity-20 text-[#f8b4b0] border border-[#ea4335] border-opacity-50'
        }`}>
          {result.message}
        </div>
      )}
    </div>
  )
}

function KillSwitchToggle({ enabled, onChange, token }) {
  const [loading, setLoading] = useState(false)

  const handleToggle = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/settings/kill-switch', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !enabled }),
      })

      if (response.ok) {
        onChange(!enabled)
      }
    } catch (err) {
      console.error('Failed to update kill switch:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-all ${
        enabled ? 'kail-kill-switch-enabled' : 'kail-kill-switch-disabled'
      } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-7' : 'translate-x-1'
        }`}
      />
    </button>
  )
}
