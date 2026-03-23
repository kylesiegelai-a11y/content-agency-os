import React, { useState, useEffect } from 'react'

export default function SystemSettings({ token, killSwitchEnabled, onKillSwitchChange }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [configJson, setConfigJson] = useState('')
  const [configError, setConfigError] = useState('')
  const [saveSuccess, setSaveSuccess] = useState('')
  const [agentStates, setAgentStates] = useState({})

  useEffect(() => {
    fetchSettings()
  }, [token])

  const fetchSettings = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/settings', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error('Failed to fetch settings')

      const data = await response.json()
      // Validate response has expected structure, otherwise use mock
      const settings = (data && data.agents) ? data : getMockSettings()
      setSettings(settings)
      setConfigJson(JSON.stringify(settings.config, null, 2))

      // Initialize agent states
      const states = {}
      settings.agents?.forEach((agent) => {
        states[agent.id] = agent.enabled
      })
      setAgentStates(states)
      setError('')
    } catch (err) {
      setError(err.message)
      const mockSettings = getMockSettings()
      setSettings(mockSettings)
      setConfigJson(JSON.stringify(mockSettings.config, null, 2))

      const states = {}
      mockSettings.agents?.forEach((agent) => {
        states[agent.id] = agent.enabled
      })
      setAgentStates(states)
    } finally {
      setLoading(false)
    }
  }

  const handleConfigSave = async () => {
    setConfigError('')
    setSaveSuccess('')

    try {
      const parsed = JSON.parse(configJson)

      const response = await fetch('/api/settings/config', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ config: parsed }),
      })

      if (!response.ok) throw new Error('Failed to save configuration')

      setSaveSuccess('Configuration saved successfully')
      setTimeout(() => setSaveSuccess(''), 5000)
    } catch (err) {
      setConfigError(err.message || 'Invalid JSON format')
    }
  }

  const handleAgentToggle = async (agentId) => {
    const newState = !agentStates[agentId]
    setAgentStates({ ...agentStates, [agentId]: newState })

    try {
      await fetch(`/api/agents/${agentId}/toggle`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: newState }),
      })
    } catch (err) {
      console.error('Failed to toggle agent:', err)
      setAgentStates({ ...agentStates, [agentId]: !newState })
    }
  }

  if (loading) {
    return (
      <div className="kail-loading">
        <svg className="kail-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" strokeWidth="2" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeWidth="2" />
        </svg>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">System Settings</h2>
        <p className="text-[#9aa0a6]">Configure system behavior, agents, and parameters</p>
      </div>

      {error && (
        <div className="kail-error">
          <p>Note: Displaying mock data - {error}</p>
        </div>
      )}

      {/* Kill Switch Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">Global Kill Switch</h3>
        <div className="kail-panel">
          <div className="flex items-center justify-between p-6 border-b border-[#3c4043]">
            <div>
              <p className="font-bold text-[#e8eaed]">System Status</p>
              <p className="text-sm text-[#9aa0a6] mt-1">
                {killSwitchEnabled
                  ? 'All agents are STOPPED. No operations running.'
                  : 'System is operational. All agents enabled.'}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <KillSwitchBadge enabled={killSwitchEnabled} />
              <KillSwitchButton
                enabled={killSwitchEnabled}
                onChange={onKillSwitchChange}
                token={token}
              />
            </div>
          </div>

          <div className="p-6 bg-[#25292f]">
            <p className="text-xs text-[#5f6368] mb-2">EMERGENCY USE ONLY</p>
            <p className="text-sm text-[#9aa0a6]">
              The kill switch immediately stops all system operations and prevents any scheduled jobs
              from executing. Use this in case of errors, budget concerns, or system issues.
            </p>
          </div>
        </div>
      </div>

      {/* Agent Controls Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">Agent Controls</h3>
        <div className="kail-panel">
          <p className="text-sm text-[#9aa0a6] mb-4">Pause or resume individual agents</p>
          <div className="space-y-2">
            {settings?.agents?.map((agent) => (
              <div key={agent.id} className="kail-agent-toggle">
                <div>
                  <p className="kail-agent-name">{agent.name}</p>
                  <p className="text-xs text-[#5f6368]">{agent.description}</p>
                </div>
                <label className="kail-toggle cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agentStates[agent.id] || false}
                    onChange={() => handleAgentToggle(agent.id)}
                    className="sr-only"
                  />
                  <div
                    className={`kail-toggle ${agentStates[agent.id] ? 'enabled' : ''}`}
                    style={{
                      backgroundColor: agentStates[agent.id] ? '#34a853' : '#25292f',
                      borderColor: agentStates[agent.id] ? '#34a853' : '#3c4043',
                    }}
                  >
                    <div className="kail-toggle-thumb" />
                  </div>
                </label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* System Status Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">System Status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="kail-panel">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#9aa0a6]">MOCK_MODE</p>
                <p className="font-bold text-[#e8eaed] mt-1">{settings?.mockMode ? 'Enabled' : 'Disabled'}</p>
              </div>
              <div
                className={`px-4 py-2 rounded font-medium ${
                  settings?.mockMode
                    ? 'bg-[#fbbc04] bg-opacity-20 text-[#f9d574]'
                    : 'bg-[#34a853] bg-opacity-20 text-[#81c995]'
                }`}
              >
                {settings?.mockMode ? '🟡 Testing' : '🟢 Production'}
              </div>
            </div>
          </div>

          <div className="kail-panel">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#9aa0a6]">System Version</p>
                <p className="font-bold text-[#e8eaed] mt-1">{settings?.version || '1.0.0'}</p>
              </div>
              <div className="text-2xl">⚙️</div>
            </div>
          </div>

          <div className="kail-panel">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#9aa0a6]">Redis Connection</p>
                <p className="font-bold text-[#e8eaed] mt-1">
                  {settings?.redis?.connected ? 'Connected' : 'Disconnected'}
                </p>
              </div>
              <div
                className={`w-3 h-3 rounded-full ${
                  settings?.redis?.connected ? 'bg-[#34a853]' : 'bg-[#ea4335]'
                }`}
              />
            </div>
          </div>

          <div className="kail-panel">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#9aa0a6]">API Status</p>
                <p className="font-bold text-[#e8eaed] mt-1">Operational</p>
              </div>
              <div className="w-3 h-3 rounded-full bg-[#34a853]" />
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Editor Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">Configuration Editor</h3>
        <div className="kail-panel">
          <p className="text-sm text-[#9aa0a6] mb-4">Edit system configuration (JSON)</p>

          {configError && (
            <div className="kail-error mb-4">
              <p>{configError}</p>
            </div>
          )}

          {saveSuccess && (
            <div className="kail-success mb-4">
              <p>{saveSuccess}</p>
            </div>
          )}

          <textarea
            value={configJson}
            onChange={(e) => {
              setConfigJson(e.target.value)
              setConfigError('')
            }}
            className="kail-json-editor kail-textarea h-96 font-mono text-sm"
          />

          <button
            onClick={handleConfigSave}
            className="kail-button-primary mt-4 w-full md:w-auto"
          >
            💾 Save Configuration
          </button>
        </div>
      </div>

      {/* Prompt Versions Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">Prompt Versions</h3>
        <div className="kail-panel space-y-3">
          {settings?.prompts?.map((prompt) => (
            <div key={prompt.id} className="bg-[#25292f] rounded p-4 border border-[#3c4043]">
              <div className="flex items-center justify-between mb-2">
                <p className="font-bold text-[#e8eaed]">{prompt.name}</p>
                <span className="text-xs bg-[#1a73e8] bg-opacity-20 text-[#aecbfa] px-2 py-1 rounded">
                  v{prompt.version}
                </span>
              </div>
              <p className="text-sm text-[#9aa0a6]">{prompt.description}</p>
              <div className="flex justify-between items-center mt-3">
                <span className="text-xs text-[#5f6368]">
                  Updated: {new Date(prompt.updatedAt).toLocaleDateString()}
                </span>
                <button className="text-[#1a73e8] hover:text-[#aecbfa] text-sm font-medium">
                  View Details
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* API Keys Section */}
      <div className="kail-settings-section">
        <h3 className="kail-settings-title">API Keys</h3>
        <div className="kail-panel">
          <div className="space-y-3">
            {settings?.apiKeys?.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-3 bg-[#25292f] rounded">
                <div>
                  <p className="font-medium text-[#e8eaed]">{key.name}</p>
                  <p className="text-xs text-[#5f6368]">
                    {key.key.substring(0, 10)}...{key.key.substring(key.key.length - 4)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      key.active
                        ? 'bg-[#34a853] bg-opacity-20 text-[#81c995]'
                        : 'bg-[#5f6368] bg-opacity-20 text-[#9aa0a6]'
                    }`}
                  >
                    {key.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function KillSwitchBadge({ enabled }) {
  return (
    <div
      className={`px-4 py-2 rounded-lg font-bold ${
        enabled
          ? 'bg-[#ea4335] bg-opacity-20 text-[#f8b4b0]'
          : 'bg-[#34a853] bg-opacity-20 text-[#81c995]'
      }`}
    >
      {enabled ? '🛑 STOPPED' : '✓ ACTIVE'}
    </div>
  )
}

function KillSwitchButton({ enabled, onChange, token }) {
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
      className={`relative inline-flex h-10 w-16 items-center rounded-full transition-all font-medium text-sm ${
        enabled ? 'kail-kill-switch-enabled' : 'kail-kill-switch-disabled'
      } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-8 w-8 transform rounded-full bg-white transition-transform ${
          enabled ? 'translate-x-8' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function getMockSettings() {
  return {
    version: '1.0.0',
    mockMode: false,
    redis: {
      connected: true,
      host: 'localhost',
      port: 6379,
    },
    config: {
      app: {
        name: 'Content Agency OS',
        version: '1.0.0',
      },
      budget: {
        monthly_ceiling: 500,
        cost_thresholds: {
          warning: 0.8,
          critical: 0.95,
        },
      },
      job_processing: {
        cycle_interval_hours: 4,
        max_cost_per_job: 50,
      },
    },
    agents: [
      {
        id: 'opportunity-scout',
        name: 'Opportunity Scout',
        description: 'Finds and qualifies high-value opportunities on platforms like Upwork',
        enabled: true,
      },
      {
        id: 'proposal-writer',
        name: 'Proposal Writer',
        description: 'Generates compelling proposal copy tailored to client needs',
        enabled: true,
      },
      {
        id: 'content-creator',
        name: 'Content Creator',
        description: 'Produces high-quality, SEO-optimized content for delivery',
        enabled: true,
      },
      {
        id: 'outreach-agent',
        name: 'Outreach Agent',
        description: 'Manages cold outreach and prospecting campaigns',
        enabled: true,
      },
      {
        id: 'quality-reviewer',
        name: 'Quality Reviewer',
        description: 'Reviews content for quality and compliance before delivery',
        enabled: true,
      },
    ],
    prompts: [
      {
        id: 'opp-scout',
        name: 'Opportunity Scout Prompt',
        version: '2.3',
        description: 'Guides the opportunity scout agent in finding qualified leads',
        updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
      },
      {
        id: 'proposal',
        name: 'Proposal Generator Prompt',
        version: '1.8',
        description: 'Templates and guidelines for proposal generation',
        updatedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      },
      {
        id: 'content',
        name: 'Content Creation Prompt',
        version: '3.1',
        description: 'Master prompt for high-quality content generation',
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      },
      {
        id: 'outreach',
        name: 'Outreach Email Prompt',
        version: '1.5',
        description: 'Templates for cold outreach and follow-up emails',
        updatedAt: new Date(Date.now() - 15 * 86400000).toISOString(),
      },
    ],
    apiKeys: [
      {
        id: 'anthropic',
        name: 'Anthropic API Key',
        key: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx',
        active: true,
      },
      {
        id: 'upwork',
        name: 'Upwork API Key',
        key: 'upwork_api_xxxxxxxxxxxxxxxxxx',
        active: true,
      },
    ],
  }
}
