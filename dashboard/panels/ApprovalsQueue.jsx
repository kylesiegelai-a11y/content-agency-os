import React, { useState, useEffect } from 'react'

export default function ApprovalsQueue({ token }) {
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [revisionNotes, setRevisionNotes] = useState({})

  useEffect(() => {
    fetchApprovals()
  }, [token])

  const fetchApprovals = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/approvals', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error('Failed to fetch approvals')

      const data = await response.json()
      setApprovals(data.items || [])
      setError('')
    } catch (err) {
      setError(err.message)
      // Mock data fallback
      setApprovals(getMockApprovals())
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (id) => {
    try {
      const response = await fetch(`/api/approvals/${id}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        setApprovals(approvals.filter((a) => a.id !== id))
      }
    } catch (err) {
      setError('Failed to approve item')
    }
  }

  const handleReject = async (id) => {
    try {
      const response = await fetch(`/api/approvals/${id}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        setApprovals(approvals.filter((a) => a.id !== id))
      }
    } catch (err) {
      setError('Failed to reject item')
    }
  }

  const handleRequestRevision = async (id) => {
    try {
      const notes = revisionNotes[id] || ''
      const response = await fetch(`/api/approvals/${id}/revise`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes }),
      })

      if (response.ok) {
        setApprovals(approvals.filter((a) => a.id !== id))
        setRevisionNotes({ ...revisionNotes, [id]: '' })
      }
    } catch (err) {
      setError('Failed to request revision')
    }
  }

  const filtered = approvals.filter((a) => filter === 'all' || a.type === filter)

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
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">Approvals Queue</h2>
        <p className="text-[#9aa0a6]">Review and approve pending items from agents</p>
      </div>

      {error && (
        <div className="kail-error">
          <p>{error}</p>
        </div>
      )}

      {/* Filters */}
      <div className="kail-filter-group">
        {['all', 'opportunity', 'proposal', 'content', 'email'].map((type) => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className={`kail-filter-button ${filter === type ? 'active' : ''}`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Approvals List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="kail-panel text-center py-12">
            <p className="text-[#9aa0a6]">No pending approvals</p>
            <p className="text-sm text-[#5f6368] mt-2">All items have been processed</p>
          </div>
        ) : (
          filtered.map((item) => (
            <div key={item.id} className="kail-approval-card">
              <div className="kail-approval-header">
                <div>
                  <h3 className="font-bold text-[#e8eaed]">{item.title}</h3>
                  <span className="kail-approval-type">{item.type.toUpperCase()}</span>
                </div>
                <span className="text-xs text-[#5f6368]">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>

              {/* Context */}
              {item.context && (
                <div className="bg-[#1a1f26] rounded p-3 text-sm text-[#9aa0a6] mb-3">
                  <p className="font-medium text-[#e8eaed] mb-1">Context:</p>
                  <p>{item.context}</p>
                </div>
              )}

              {/* Content Preview */}
              <div className="kail-approval-content">
                {item.content}
              </div>

              {/* Metadata */}
              {item.metadata && (
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  {Object.entries(item.metadata).map(([key, value]) => (
                    <div key={key} className="bg-[#1a1f26] rounded p-2">
                      <p className="text-[#5f6368]">{key}:</p>
                      <p className="text-[#e8eaed] font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Revision Notes Textarea */}
              {expandedId === item.id && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-[#e8eaed] mb-2">
                    Revision Notes
                  </label>
                  <textarea
                    value={revisionNotes[item.id] || ''}
                    onChange={(e) =>
                      setRevisionNotes({
                        ...revisionNotes,
                        [item.id]: e.target.value,
                      })
                    }
                    placeholder="Describe the changes needed..."
                    className="kail-textarea h-24"
                  />
                </div>
              )}

              {/* Action Buttons */}
              <div className="kail-approval-actions">
                <button
                  onClick={() => handleApprove(item.id)}
                  className="kail-button-success flex-1"
                >
                  ✓ Approve
                </button>

                <button
                  onClick={() =>
                    expandedId === item.id
                      ? handleRequestRevision(item.id)
                      : setExpandedId(item.id)
                  }
                  className="kail-button-primary flex-1"
                >
                  {expandedId === item.id ? '📝 Submit Revision' : '✏️ Revise'}
                </button>

                <button
                  onClick={() => handleReject(item.id)}
                  className="kail-button-danger flex-1"
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Stats Footer */}
      <div className="kail-panel grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-3xl font-bold text-[#1a73e8]">{filtered.length}</p>
          <p className="text-sm text-[#9aa0a6]">Pending</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-[#fbbc04]">{approvals.length}</p>
          <p className="text-sm text-[#9aa0a6]">Total</p>
        </div>
        <div>
          <p className="text-3xl font-bold text-[#34a853]">
            {approvals.length > 0 ? Math.round((approvals.length - filtered.length) / approvals.length * 100) : 0}%
          </p>
          <p className="text-sm text-[#9aa0a6]">Approved</p>
        </div>
      </div>
    </div>
  )
}

function getMockApprovals() {
  return [
    {
      id: '1',
      type: 'opportunity',
      title: 'Upwork Opportunity: HR Compliance Guide',
      context:
        'Found opportunity from acmecorp requesting HR compliance content for $500',
      content:
        'Project: Create comprehensive HR compliance guide for tech companies\nBudget: $500\nDeadline: 5 days\nRequirements:\n- 5000+ words\n- Executive summary\n- Case studies included',
      metadata: { platform: 'Upwork', budget: '$500', match: '95%' },
      createdAt: new Date(Date.now() - 3600000).toISOString(),
    },
    {
      id: '2',
      type: 'proposal',
      title: 'Proposal Copy: KAIL Services',
      context: 'Agent-generated proposal for KAIL Data Services engagement',
      content:
        'Dear Prospective Client,\n\nWe are excited to present our comprehensive content creation solution tailored to your HR and PEO needs...',
      metadata: { client: 'KAIL Data', value: '$2000', confidence: '88%' },
      createdAt: new Date(Date.now() - 1800000).toISOString(),
    },
    {
      id: '3',
      type: 'content',
      title: 'Final Content: Benefits Administration Blog',
      context:
        'Generated content ready for delivery to client - 3000 word blog post',
      content:
        'The Complete Guide to Benefits Administration in 2026\n\nBenefits administration has evolved significantly in recent years...',
      metadata: { wordCount: '3247', quality: '9.2/10', niche: 'HR' },
      createdAt: new Date(Date.now() - 900000).toISOString(),
    },
    {
      id: '4',
      type: 'email',
      title: 'Cold Outreach Email',
      context: 'Prospecting email for new client acquisition',
      content:
        'Subject: Your Company + AI-Powered Content Creation\n\nHi [Name],\n\nI noticed your company specializes in HR solutions...',
      metadata: { target: 'HR Tech Companies', variant: 'B', personalization: 'Yes' },
      createdAt: new Date(Date.now() - 600000).toISOString(),
    },
  ]
}
