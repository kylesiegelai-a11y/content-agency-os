import { useState, useEffect } from 'react'

const STATUS_COLORS = {
  healthy: { bg: 'bg-green-900/20', border: 'border-green-800', text: 'text-green-400', dot: 'bg-green-400' },
  degraded: { bg: 'bg-yellow-900/20', border: 'border-yellow-800', text: 'text-yellow-400', dot: 'bg-yellow-400' },
  critical: { bg: 'bg-red-900/20', border: 'border-red-800', text: 'text-red-400', dot: 'bg-red-400' },
  error: { bg: 'bg-red-900/20', border: 'border-red-800', text: 'text-red-400', dot: 'bg-red-400' }
}

const ALERT_COLORS = {
  critical: 'bg-red-900/20 border-red-800 text-red-400',
  warning: 'bg-yellow-900/20 border-yellow-800 text-yellow-400',
  info: 'bg-blue-900/20 border-blue-800 text-blue-400'
}

export default function ObservabilityPanel({ token }) {
  const [health, setHealth] = useState(null)
  const [backups, setBackups] = useState([])
  const [apiKeys, setApiKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [activeTab, setActiveTab] = useState('health')
  const [backupLoading, setBackupLoading] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [newKeyResult, setNewKeyResult] = useState(null)

  useEffect(() => { refresh() }, [])

  const refresh = async () => {
    setLoading(true)
    try {
      const [healthRes, backupsRes, keysRes] = await Promise.all([
        fetch('/api/health', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/backups', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/auth/api-keys', { headers: { Authorization: `Bearer ${token}` } })
      ])
      if (healthRes.ok) setHealth(await healthRes.json())
      if (backupsRes.ok) { const d = await backupsRes.json(); setBackups(d.backups || []) }
      if (keysRes.ok) { const d = await keysRes.json(); setApiKeys(d.keys || []) }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const showMsg = (setter, msg) => { setter(msg); setTimeout(() => setter(null), 4000) }

  const createBackup = async () => {
    setBackupLoading(true)
    try {
      const res = await fetch('/api/backup', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      if (data.success) {
        showMsg(setSuccess, `Backup created: ${data.files.length} files, ${data.totalSizeKB}KB`)
        refresh()
      } else { showMsg(setError, data.error || 'Backup failed') }
    } catch (err) { showMsg(setError, err.message) }
    finally { setBackupLoading(false) }
  }

  const restoreBackup = async (name) => {
    if (!confirm(`Restore from ${name}? A safety backup will be created first.`)) return
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupName: name })
      })
      const data = await res.json()
      if (data.restored) {
        showMsg(setSuccess, `Restored ${data.filesRestored.length} files from ${name}`)
        refresh()
      } else { showMsg(setError, data.error || 'Restore failed') }
    } catch (err) { showMsg(setError, err.message) }
  }

  const createApiKey = async () => {
    try {
      const res = await fetch('/api/auth/api-keys', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newKeyLabel || 'default' })
      })
      const data = await res.json()
      if (data.success) {
        setNewKeyResult(data.apiKey)
        setNewKeyLabel('')
        refresh()
      } else { showMsg(setError, data.error) }
    } catch (err) { showMsg(setError, err.message) }
  }

  const revokeApiKey = async (prefix) => {
    if (!confirm(`Revoke API key ${prefix}?`)) return
    try {
      await fetch('/api/auth/api-keys', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix })
      })
      showMsg(setSuccess, 'API key revoked')
      refresh()
    } catch (err) { showMsg(setError, err.message) }
  }

  if (loading) {
    return <div className="kail-panel animate-pulse"><div className="h-6 bg-[#25292f] rounded w-1/3 mb-4"></div>
      <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="h-16 bg-[#25292f] rounded"></div>)}</div></div>
  }

  const sc = STATUS_COLORS[health?.status] || STATUS_COLORS.error
  const tabs = [
    { id: 'health', label: 'System Health' },
    { id: 'alerts', label: 'Alerts' },
    { id: 'backups', label: 'Backups' },
    { id: 'apikeys', label: 'API Keys' }
  ]

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 rounded text-sm">{error}</div>}
      {success && <div className="bg-green-900/20 border border-green-800 text-green-400 px-4 py-2 rounded text-sm">{success}</div>}

      {/* Status banner */}
      <div className={`kail-panel ${sc.bg} border ${sc.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full ${sc.dot} animate-pulse`}></span>
            <span className={`text-lg font-bold ${sc.text} uppercase`}>{health?.status || 'unknown'}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[#9aa0a6]">
            <span>Uptime: {health?.uptime?.human || '—'}</span>
            <button onClick={refresh} className="text-[#1a73e8] hover:underline text-xs">Refresh</button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id ? 'bg-[#1a73e8] text-white' : 'bg-[#1e2228] text-[#9aa0a6] hover:bg-[#25292f]'
            }`}>{tab.label}</button>
        ))}
      </div>

      {/* HEALTH TAB */}
      {activeTab === 'health' && health && (
        <div className="space-y-6">
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Process Metrics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Jobs Processed', value: health.process.jobsProcessed, color: '#8ab4f8' },
                { label: 'Jobs Failed', value: health.process.jobsFailed, color: '#f8b4b0' },
                { label: 'Error Rate', value: health.process.errorRate, color: parseInt(health.process.errorRate) > 20 ? '#ea4335' : '#81c995' },
                { label: 'Consecutive Fails', value: health.process.consecutiveFailures, color: health.process.consecutiveFailures >= 3 ? '#ea4335' : '#e8eaed' }
              ].map((m, i) => (
                <div key={i} className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                  <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">{m.label}</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: m.color }}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          {health.process.agentErrors && Object.keys(health.process.agentErrors).length > 0 && (
            <div className="kail-panel">
              <h3 className="text-sm font-bold text-[#e8eaed] mb-3">Agent Error Counts</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(health.process.agentErrors).map(([agent, count]) => (
                  <span key={agent} className="px-3 py-1 bg-red-900/20 border border-red-800 rounded text-xs text-red-400">
                    {agent}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Jobs</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total', value: health.jobs.total },
                { label: 'Active', value: health.jobs.active, color: '#8ab4f8' },
                { label: 'Completed', value: health.jobs.completed, color: '#81c995' },
                { label: 'Failed', value: health.jobs.failed, color: '#f8b4b0' }
              ].map((m, i) => (
                <div key={i} className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                  <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">{m.label}</p>
                  <p className="text-2xl font-bold mt-1" style={{ color: m.color || '#e8eaed' }}>{m.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Data Stores ({health.totalDataSizeMB}MB)</h2>
            <div className="space-y-2">
              {Object.entries(health.dataStores || {}).map(([file, info]) => (
                <div key={file} className="flex justify-between bg-[#1e2228] rounded px-4 py-2 border border-[#303438] text-sm">
                  <span className="text-[#e8eaed]">{file}</span>
                  <span className="text-[#9aa0a6]">{info.sizeKB}KB</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ALERTS TAB */}
      {activeTab === 'alerts' && (
        <div className="kail-panel">
          <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Recent Alerts</h2>
          {(!health?.recentAlerts || health.recentAlerts.length === 0) ? (
            <p className="text-sm text-[#9aa0a6]">No alerts fired yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {health.recentAlerts.map((a, i) => (
                <div key={i} className={`rounded-lg px-4 py-3 border text-sm ${ALERT_COLORS[a.level] || ALERT_COLORS.info}`}>
                  <div className="flex justify-between">
                    <span className="font-medium uppercase text-xs">{a.level}: {a.type}</span>
                    <span className="text-xs opacity-70">{new Date(a.timestamp).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs opacity-90">{a.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BACKUPS TAB */}
      {activeTab === 'backups' && (
        <div className="space-y-6">
          <div className="kail-panel">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-[#e8eaed]">Backups</h2>
              <button onClick={createBackup} disabled={backupLoading}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${backupLoading ? 'bg-[#1557b0] opacity-70 cursor-wait' : 'bg-[#1a73e8] hover:bg-[#1557b0]'} text-white`}>
                {backupLoading ? 'Creating...' : 'Create Backup'}
              </button>
            </div>
            {backups.length === 0 ? (
              <p className="text-sm text-[#9aa0a6]">No backups yet. Create one to protect your data.</p>
            ) : (
              <div className="space-y-2">
                {backups.map((b, i) => (
                  <div key={i} className="flex justify-between items-center bg-[#1e2228] rounded-lg px-4 py-3 border border-[#303438]">
                    <div>
                      <span className="text-sm text-[#e8eaed]">{b.name}</span>
                      <span className="ml-3 text-xs text-[#9aa0a6]">{b.fileCount} files, {b.totalSizeKB}KB</span>
                    </div>
                    <button onClick={() => restoreBackup(b.name)}
                      className="text-xs text-[#fbbc04] hover:text-[#f9d71c]">Restore</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* API KEYS TAB */}
      {activeTab === 'apikeys' && (
        <div className="space-y-6">
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">API Keys</h2>
            <p className="text-sm text-[#9aa0a6] mb-4">
              API keys allow programmatic access (CLI, webhooks, integrations). Use <code className="bg-[#25292f] px-1 py-0.5 rounded text-[#81c995]">Authorization: Bearer cao_...</code> in requests.
            </p>
            <div className="flex gap-3 mb-4">
              <input type="text" value={newKeyLabel} onChange={e => setNewKeyLabel(e.target.value)} placeholder="Key label (e.g. CI/CD)"
                className="flex-1 bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
              <button onClick={createApiKey}
                className="px-6 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-sm font-medium">Generate Key</button>
            </div>

            {newKeyResult && (
              <div className="bg-green-900/20 border border-green-800 rounded-lg p-4 mb-4">
                <p className="text-sm text-green-400 font-bold mb-2">New API Key (copy now — shown once):</p>
                <code className="block bg-[#1e2228] rounded px-3 py-2 text-sm text-[#e8eaed] break-all select-all">{newKeyResult}</code>
                <button onClick={() => setNewKeyResult(null)} className="mt-2 text-xs text-[#9aa0a6] hover:text-[#e8eaed]">Dismiss</button>
              </div>
            )}

            {apiKeys.length === 0 ? (
              <p className="text-sm text-[#9aa0a6]">No API keys created yet.</p>
            ) : (
              <div className="space-y-2">
                {apiKeys.map((k, i) => (
                  <div key={i} className="flex justify-between items-center bg-[#1e2228] rounded-lg px-4 py-3 border border-[#303438]">
                    <div>
                      <span className="text-sm text-[#e8eaed] font-mono">{k.prefix}</span>
                      <span className="ml-2 text-xs text-[#9aa0a6]">{k.label}</span>
                      <span className="ml-2 text-xs text-[#5f6368]">Created {new Date(k.createdAt).toLocaleDateString()}</span>
                      {k.lastUsedAt && <span className="ml-2 text-xs text-[#5f6368]">Last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>}
                    </div>
                    <button onClick={() => revokeApiKey(k.prefix)}
                      className="text-xs text-red-400 hover:text-red-300">Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
