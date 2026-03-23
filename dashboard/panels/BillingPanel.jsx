import { useState, useEffect } from 'react'

export default function BillingPanel({ token }) {
  const [invoices, setInvoices] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    fetchInvoices()
    fetchSummary()
  }, [filter])

  const fetchInvoices = async () => {
    try {
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const response = await fetch(`/api/invoices${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch invoices')
      const data = await response.json()
      setInvoices(data.invoices || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchSummary = async () => {
    try {
      const response = await fetch('/api/invoices/summary?period=month', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch summary')
      const data = await response.json()
      setSummary(data.summary)
    } catch (err) {
      // Non-critical — summary cards just won't show
    }
  }

  const handleAction = async (invoiceId, action) => {
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/${action}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || 'Action failed')
      }
      await fetchInvoices()
      await fetchSummary()
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 3000)
    }
  }

  const statusColor = (status) => {
    switch (status) {
      case 'paid': return 'bg-green-900/30 text-green-400 border-green-800'
      case 'sent': return 'bg-blue-900/30 text-blue-400 border-blue-800'
      case 'draft': return 'bg-gray-700/30 text-gray-400 border-gray-600'
      case 'overdue': return 'bg-red-900/30 text-red-400 border-red-800'
      case 'cancelled': return 'bg-gray-800/30 text-gray-500 border-gray-700'
      default: return 'bg-gray-700/30 text-gray-400 border-gray-600'
    }
  }

  const formatCurrency = (amount) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0)

  const formatDate = (dateStr) => {
    if (!dateStr) return '—'
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SummaryCard label="Revenue (Paid)" value={formatCurrency(summary.revenue)} color="text-green-400" />
          <SummaryCard label="Outstanding" value={formatCurrency(summary.outstanding)} color="text-yellow-400" />
          <SummaryCard label="Avg Invoice" value={formatCurrency(summary.avgInvoiceAmount)} color="text-blue-400" />
          <SummaryCard label="Invoices" value={summary.invoiceCount} color="text-[#e8eaed]" />
        </div>
      )}

      {/* Invoice List */}
      <div className="kail-panel">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-[#e8eaed]">Invoices</h2>
          <div className="flex gap-2">
            {['all', 'draft', 'sent', 'paid', 'overdue'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  filter === f
                    ? 'bg-[#1a73e8] text-white'
                    : 'bg-[#25292f] text-[#9aa0a6] hover:bg-[#303438]'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        {invoices.length === 0 ? (
          <div className="text-center py-12 text-[#9aa0a6]">
            <p className="text-lg mb-2">No invoices yet</p>
            <p className="text-sm">Invoices are auto-generated when jobs reach DELIVERED state</p>
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map(inv => (
              <div key={inv.id} className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-mono text-[#9aa0a6]">{inv.id}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusColor(inv.status)}`}>
                        {inv.status.toUpperCase()}
                      </span>
                      {inv.billingModel === 'retainer' && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-900/30 text-purple-400 border border-purple-800">
                          RETAINER
                        </span>
                      )}
                    </div>
                    <p className="text-[#e8eaed] font-medium">
                      {inv.lineItems?.[0]?.description || 'Invoice'}
                    </p>
                    <p className="text-sm text-[#9aa0a6] mt-1">
                      {inv.client?.name || 'Unknown Client'} · Due {formatDate(inv.dueAt)}
                      {inv.paidAt && ` · Paid ${formatDate(inv.paidAt)}`}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-lg font-bold text-[#e8eaed]">{formatCurrency(inv.total)}</p>
                    <div className="flex gap-2 mt-2 justify-end">
                      {inv.status === 'draft' && (
                        <>
                          <button
                            onClick={() => handleAction(inv.id, 'send')}
                            className="px-3 py-1 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"
                          >
                            Send
                          </button>
                          <button
                            onClick={() => handleAction(inv.id, 'cancel')}
                            className="px-3 py-1 rounded text-xs font-medium bg-[#25292f] text-[#9aa0a6] hover:bg-[#303438]"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {(inv.status === 'sent' || inv.status === 'overdue') && (
                        <button
                          onClick={() => handleAction(inv.id, 'pay')}
                          className="px-3 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700"
                        >
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }) {
  return (
    <div className="kail-panel">
      <p className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}
