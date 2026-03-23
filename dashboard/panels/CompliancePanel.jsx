import { useState, useEffect } from 'react'

export default function CompliancePanel({ token }) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')

  // Form state
  const [suppressEmail, setSuppressEmail] = useState('')
  const [suppressDomain, setSuppressDomain] = useState('')
  const [suppressReason, setSuppressReason] = useState('')
  const [purgeEmail, setPurgeEmail] = useState('')
  const [purgeRegulation, setPurgeRegulation] = useState('manual')
  const [checkEmail, setCheckEmail] = useState('')
  const [checkResult, setCheckResult] = useState(null)

  useEffect(() => { fetchSummary() }, [])

  const fetchSummary = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/compliance/summary', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch compliance data')
      const data = await response.json()
      setSummary(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const showSuccess = (msg) => {
    setSuccess(msg)
    setTimeout(() => setSuccess(null), 3000)
  }

  const showError = (msg) => {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  const addEmailSuppression = async () => {
    if (!suppressEmail.trim()) return showError('Enter an email')
    try {
      const res = await fetch('/api/compliance/suppression/email', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: suppressEmail, reason: suppressReason || 'manual' })
      })
      const data = await res.json()
      if (data.added) {
        showSuccess(`${suppressEmail} added to suppression list`)
        setSuppressEmail('')
        setSuppressReason('')
        fetchSummary()
      } else {
        showError(data.reason || 'Could not add')
      }
    } catch (err) { showError(err.message) }
  }

  const removeEmailSuppression = async (email) => {
    try {
      await fetch('/api/compliance/suppression/email', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      showSuccess(`${email} removed`)
      fetchSummary()
    } catch (err) { showError(err.message) }
  }

  const addDomainSuppression = async () => {
    if (!suppressDomain.trim()) return showError('Enter a domain')
    try {
      const res = await fetch('/api/compliance/suppression/domain', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: suppressDomain, reason: suppressReason || 'manual' })
      })
      const data = await res.json()
      if (data.added) {
        showSuccess(`${suppressDomain} domain suppressed`)
        setSuppressDomain('')
        setSuppressReason('')
        fetchSummary()
      } else {
        showError(data.reason || 'Could not add')
      }
    } catch (err) { showError(err.message) }
  }

  const removeDomainSuppression = async (domain) => {
    try {
      await fetch('/api/compliance/suppression/domain', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain })
      })
      showSuccess(`${domain} removed`)
      fetchSummary()
    } catch (err) { showError(err.message) }
  }

  const runPreSendCheck = async () => {
    if (!checkEmail.trim()) return showError('Enter an email to check')
    try {
      const res = await fetch('/api/compliance/check', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: checkEmail })
      })
      const data = await res.json()
      setCheckResult(data)
    } catch (err) { showError(err.message) }
  }

  const executePurge = async () => {
    if (!purgeEmail.trim()) return showError('Enter an email to purge')
    if (!confirm(`This will permanently remove all data associated with ${purgeEmail}. Continue?`)) return
    try {
      const res = await fetch('/api/compliance/purge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: purgeEmail, regulation: purgeRegulation })
      })
      const data = await res.json()
      if (data.purged) {
        showSuccess(`Purged ${data.totalRecordsAffected} records for ${purgeEmail}`)
        setPurgeEmail('')
        fetchSummary()
      } else {
        showError(data.reason || 'Purge failed')
      }
    } catch (err) { showError(err.message) }
  }

  if (loading) {
    return (
      <div className="kail-panel animate-pulse">
        <div className="h-6 bg-[#25292f] rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-[#25292f] rounded"></div>)}
        </div>
      </div>
    )
  }

  const rl = summary?.rateLimits || {}
  const supp = summary?.suppression || {}
  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'suppression', label: 'Suppression List' },
    { id: 'purge', label: 'Data Purge' },
    { id: 'audit', label: 'Audit Log' }
  ]

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {error && <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 rounded text-sm">{error}</div>}
      {success && <div className="bg-green-900/20 border border-green-800 text-green-400 px-4 py-2 rounded text-sm">{success}</div>}

      {/* Tab nav */}
      <div className="flex gap-2">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id ? 'bg-[#1a73e8] text-white' : 'bg-[#1e2228] text-[#9aa0a6] hover:bg-[#25292f]'
            }`}>{tab.label}</button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Rate limit cards */}
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Rate Limits (Today)</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">Emails Sent</p>
                <p className="text-2xl font-bold text-[#e8eaed] mt-1">{rl.totalSent || 0} <span className="text-sm text-[#9aa0a6]">/ {rl.maxTotal || 100}</span></p>
                <div className="mt-2 h-2 bg-[#303438] rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, ((rl.totalSent || 0) / (rl.maxTotal || 100)) * 100)}%`,
                      background: (rl.totalSent || 0) > (rl.maxTotal || 100) * 0.8 ? '#ea4335' : '#1a73e8'
                    }}></div>
                </div>
              </div>
              <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">Remaining</p>
                <p className="text-2xl font-bold text-[#81c995] mt-1">{rl.remainingTotal || rl.maxTotal || 100}</p>
                <p className="text-xs text-[#9aa0a6] mt-1">Per domain: {rl.maxPerDomain || 25}/day</p>
              </div>
              <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">Cooldown</p>
                <p className="text-2xl font-bold text-[#e8eaed] mt-1">{(rl.cooldownMs || 120000) / 1000}s</p>
                <p className="text-xs text-[#9aa0a6] mt-1">Between sends</p>
              </div>
            </div>
            {/* Domain breakdown */}
            {rl.domains && Object.keys(rl.domains).length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide mb-2">Domains Contacted Today</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(rl.domains).map(([domain, count]) => (
                    <span key={domain} className="px-3 py-1 bg-[#1e2228] border border-[#303438] rounded text-xs text-[#e8eaed]">
                      {domain}: <strong>{count}</strong>/{rl.maxPerDomain || 25}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Suppression summary */}
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Suppression Summary</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">Suppressed Emails</p>
                <p className="text-2xl font-bold text-[#fbbc04] mt-1">{supp.totalEmails || 0}</p>
              </div>
              <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <p className="text-xs text-[#9aa0a6] uppercase tracking-wide">Suppressed Domains</p>
                <p className="text-2xl font-bold text-[#fbbc04] mt-1">{supp.totalDomains || 0}</p>
              </div>
            </div>
          </div>

          {/* Pre-send check */}
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Pre-Send Check</h2>
            <div className="flex gap-3">
              <input type="email" value={checkEmail} onChange={e => setCheckEmail(e.target.value)} placeholder="test@example.com"
                className="flex-1 bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
              <button onClick={runPreSendCheck}
                className="px-6 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-sm font-medium">Check</button>
            </div>
            {checkResult && (
              <div className={`mt-3 px-4 py-3 rounded-lg text-sm ${
                checkResult.allowed
                  ? 'bg-green-900/20 border border-green-800 text-green-400'
                  : 'bg-red-900/20 border border-red-800 text-red-400'
              }`}>
                {checkResult.allowed ? 'Allowed — no blocks' : `Blocked: ${checkResult.reason}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUPPRESSION TAB */}
      {activeTab === 'suppression' && (
        <div className="space-y-6">
          {/* Add email */}
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Add to Suppression List</h2>
            <div className="space-y-3">
              <div className="flex gap-3">
                <input type="email" value={suppressEmail} onChange={e => setSuppressEmail(e.target.value)} placeholder="email@example.com"
                  className="flex-1 bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
                <button onClick={addEmailSuppression}
                  className="px-6 py-2 bg-[#ea4335] hover:bg-[#c5221f] text-white rounded-lg text-sm font-medium">Suppress Email</button>
              </div>
              <div className="flex gap-3">
                <input type="text" value={suppressDomain} onChange={e => setSuppressDomain(e.target.value)} placeholder="example.com"
                  className="flex-1 bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
                <button onClick={addDomainSuppression}
                  className="px-6 py-2 bg-[#ea4335] hover:bg-[#c5221f] text-white rounded-lg text-sm font-medium">Suppress Domain</button>
              </div>
              <input type="text" value={suppressReason} onChange={e => setSuppressReason(e.target.value)} placeholder="Reason (optional)"
                className="w-full bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
            </div>
          </div>

          {/* Email list */}
          <div className="kail-panel">
            <h3 className="text-sm font-bold text-[#e8eaed] mb-3">Suppressed Emails ({supp.totalEmails || 0})</h3>
            {(!supp.emails || supp.emails.length === 0) ? (
              <p className="text-sm text-[#9aa0a6]">No emails suppressed yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {supp.emails.map((entry, i) => (
                  <div key={i} className="flex justify-between items-center bg-[#1e2228] rounded-lg px-4 py-2 border border-[#303438]">
                    <div>
                      <span className="text-sm text-[#e8eaed]">{entry.email}</span>
                      <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-700/30 text-gray-400 border border-gray-600">{entry.source}</span>
                      {entry.reason && <span className="ml-2 text-xs text-[#9aa0a6]">{entry.reason}</span>}
                    </div>
                    <button onClick={() => removeEmailSuppression(entry.email)}
                      className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Domain list */}
          <div className="kail-panel">
            <h3 className="text-sm font-bold text-[#e8eaed] mb-3">Suppressed Domains ({supp.totalDomains || 0})</h3>
            {(!supp.domains || supp.domains.length === 0) ? (
              <p className="text-sm text-[#9aa0a6]">No domains suppressed yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {supp.domains.map((entry, i) => (
                  <div key={i} className="flex justify-between items-center bg-[#1e2228] rounded-lg px-4 py-2 border border-[#303438]">
                    <div>
                      <span className="text-sm text-[#e8eaed]">{entry.domain}</span>
                      {entry.reason && <span className="ml-2 text-xs text-[#9aa0a6]">{entry.reason}</span>}
                    </div>
                    <button onClick={() => removeDomainSuppression(entry.domain)}
                      className="text-xs text-red-400 hover:text-red-300">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PURGE TAB */}
      {activeTab === 'purge' && (
        <div className="space-y-6">
          <div className="kail-panel">
            <h2 className="text-lg font-bold text-[#e8eaed] mb-2">GDPR / CCPA Data Purge</h2>
            <p className="text-sm text-[#9aa0a6] mb-4">
              Permanently remove all personal data associated with an email address. This anonymizes records in jobs, invoices, activity logs, and send history. The purge action itself is logged for audit compliance.
            </p>
            <div className="space-y-3">
              <input type="email" value={purgeEmail} onChange={e => setPurgeEmail(e.target.value)} placeholder="email@example.com"
                className="w-full bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]" />
              <div className="flex gap-3 items-center">
                <select value={purgeRegulation} onChange={e => setPurgeRegulation(e.target.value)}
                  className="bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]">
                  <option value="manual">Manual Request</option>
                  <option value="GDPR">GDPR (EU)</option>
                  <option value="CCPA">CCPA (California)</option>
                </select>
                <button onClick={executePurge}
                  className="px-6 py-2 bg-[#ea4335] hover:bg-[#c5221f] text-white rounded-lg text-sm font-medium">Execute Purge</button>
              </div>
            </div>
          </div>

          {/* Purge history */}
          <div className="kail-panel">
            <h3 className="text-sm font-bold text-[#e8eaed] mb-3">Purge History</h3>
            {(!summary?.purgeLog || summary.purgeLog.length === 0) ? (
              <p className="text-sm text-[#9aa0a6]">No purges executed yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {summary.purgeLog.map((entry, i) => (
                  <div key={i} className="bg-[#1e2228] rounded-lg px-4 py-3 border border-[#303438]">
                    <div className="flex justify-between">
                      <span className="text-sm text-[#e8eaed]">{entry.email}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-800">{entry.regulation}</span>
                    </div>
                    <p className="text-xs text-[#9aa0a6] mt-1">
                      {new Date(entry.requestedAt).toLocaleString()} — {Object.entries(entry.removedFrom || {}).map(([k, v]) => `${k}: ${v}`).join(', ') || 'no records found'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* AUDIT LOG TAB */}
      {activeTab === 'audit' && (
        <div className="kail-panel">
          <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Audit Log</h2>
          {(!summary?.recentAuditLog || summary.recentAuditLog.length === 0) ? (
            <p className="text-sm text-[#9aa0a6]">No audit events yet.</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {summary.recentAuditLog.map((entry, i) => (
                <div key={i} className="bg-[#1e2228] rounded-lg px-4 py-3 border border-[#303438]">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs px-2 py-0.5 rounded font-medium border"
                        style={{
                          background: entry.action.includes('purge') ? 'rgba(234,67,53,0.15)' : 'rgba(26,115,232,0.15)',
                          borderColor: entry.action.includes('purge') ? '#ea4335' : '#1a73e8',
                          color: entry.action.includes('purge') ? '#f8b4b0' : '#8ab4f8'
                        }}>{entry.action}</span>
                      <span className="ml-2 text-sm text-[#e8eaed]">{entry.email || entry.domain || ''}</span>
                    </div>
                    <span className="text-xs text-[#9aa0a6]">{new Date(entry.timestamp).toLocaleString()}</span>
                  </div>
                  {entry.reason && <p className="text-xs text-[#9aa0a6] mt-1">{entry.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
