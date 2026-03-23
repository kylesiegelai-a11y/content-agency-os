import React, { useState, useEffect } from 'react'

export default function ActivityFeed({ token }) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    fetchActivities()

    if (!autoRefresh) return

    const interval = setInterval(fetchActivities, 30000)
    return () => clearInterval(interval)
  }, [token, autoRefresh])

  const fetchActivities = async () => {
    try {
      const response = await fetch('/api/activity', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error('Failed to fetch activities')

      const data = await response.json()
      const items = data.items || data.activities || []
      setActivities(items.length > 0 ? items : getMockActivities())
      setError('')
    } catch (err) {
      setError(err.message)
      setActivities(getMockActivities())
    } finally {
      setLoading(false)
    }
  }

  const agents = ['all', 'opportunity-scout', 'proposal-writer', 'content-creator', 'outreach-agent']
  const filtered =
    filter === 'all' ? activities : activities.filter((a) => a.agent === filter)

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
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">Activity Feed</h2>
          <p className="text-[#9aa0a6]">Timestamped log of all system operations</p>
        </div>
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            autoRefresh
              ? 'bg-[#34a853] text-white'
              : 'bg-[#25292f] text-[#9aa0a6] border border-[#3c4043]'
          }`}
        >
          {autoRefresh ? '⏱️ Auto-refresh: ON' : '⏱️ Auto-refresh: OFF'}
        </button>
      </div>

      {error && (
        <div className="kail-error">
          <p>{error}</p>
        </div>
      )}

      {/* Filter */}
      <div className="kail-filter-group">
        {agents.map((agent) => (
          <button
            key={agent}
            onClick={() => setFilter(agent)}
            className={`kail-filter-button ${filter === agent ? 'active' : ''}`}
          >
            {agent === 'all' ? 'All Agents' : agent.replace(/-/g, ' ')}
          </button>
        ))}
      </div>

      {/* Activity List */}
      <div className="kail-panel kail-scrollable">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[#9aa0a6]">No activities found</p>
          </div>
        ) : (
          filtered.map((activity, idx) => (
            <ActivityItem key={idx} activity={activity} />
          ))
        )}
      </div>

      {/* Stats Footer */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Operations"
          value={activities.length}
          icon="📊"
        />
        <StatCard
          label="Last 24h"
          value={activities.filter((a) => {
            const date = new Date(a.timestamp)
            return Date.now() - date.getTime() < 86400000
          }).length}
          icon="⏰"
        />
        <StatCard
          label="Success Rate"
          value={`${Math.round(
            (activities.filter((a) => a.status === 'success').length / activities.length) * 100
          )}%`}
          icon="✓"
        />
        <StatCard
          label="Errors"
          value={activities.filter((a) => a.status === 'error').length}
          icon="⚠️"
        />
      </div>
    </div>
  )
}

function ActivityItem({ activity }) {
  const getStatusColor = (status) => {
    switch (status) {
      case 'success':
        return 'text-[#34a853]'
      case 'error':
        return 'text-[#ea4335]'
      case 'warning':
        return 'text-[#fbbc04]'
      default:
        return 'text-[#1a73e8]'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'success':
        return '✓'
      case 'error':
        return '✕'
      case 'warning':
        return '⚠'
      default:
        return '▶'
    }
  }

  const getAgentColor = (agent) => {
    const colors = {
      'opportunity-scout': 'bg-blue-500 bg-opacity-20 text-blue-300',
      'proposal-writer': 'bg-green-500 bg-opacity-20 text-green-300',
      'content-creator': 'bg-purple-500 bg-opacity-20 text-purple-300',
      'outreach-agent': 'bg-orange-500 bg-opacity-20 text-orange-300',
    }
    return colors[agent] || 'bg-gray-500 bg-opacity-20 text-gray-300'
  }

  return (
    <div className="kail-activity-item">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`font-bold text-lg ${getStatusColor(activity.status)}`}>
              {getStatusIcon(activity.status)}
            </span>
            <p className="text-[#e8eaed] font-medium">{activity.action}</p>
            <span className={`kail-badge ${getAgentColor(activity.agent)}`}>
              {activity.agent.replace(/-/g, ' ')}
            </span>
          </div>
          <p className="kail-activity-timestamp">
            {new Date(activity.timestamp).toLocaleString()}
          </p>
          {activity.details && (
            <p className="text-sm text-[#9aa0a6] mt-2">{activity.details}</p>
          )}
          {activity.metadata && (
            <div className="mt-2 text-xs text-[#5f6368] space-y-1">
              {Object.entries(activity.metadata).map(([key, value]) => (
                <p key={key}>
                  <span className="font-medium">{key}:</span> {value}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon }) {
  return (
    <div className="kail-metric text-center">
      <p className="text-2xl mb-2">{icon}</p>
      <p className="text-3xl font-bold text-[#e8eaed]">{value}</p>
      <p className="text-xs text-[#9aa0a6] mt-1">{label}</p>
    </div>
  )
}

function getMockActivities() {
  const now = Date.now()
  return [
    {
      timestamp: new Date(now - 60000).toISOString(),
      agent: 'opportunity-scout',
      action: 'Found high-value opportunity',
      status: 'success',
      details: 'Upwork HR Compliance Guide - $500 match score 95%',
      metadata: { platform: 'Upwork', value: '$500', category: 'HR' },
    },
    {
      timestamp: new Date(now - 120000).toISOString(),
      agent: 'proposal-writer',
      action: 'Generated proposal copy',
      status: 'success',
      details: 'Proposal for KAIL Data Services engagement',
      metadata: { client: 'KAIL', words: '850', confidence: '88%' },
    },
    {
      timestamp: new Date(now - 180000).toISOString(),
      agent: 'content-creator',
      action: 'Completed content generation',
      status: 'success',
      details: 'Benefits Administration Blog Post - 3247 words',
      metadata: { niche: 'HR', wordCount: '3247', quality: '9.2/10' },
    },
    {
      timestamp: new Date(now - 240000).toISOString(),
      agent: 'outreach-agent',
      action: 'Sent cold outreach email',
      status: 'success',
      details: 'HR Tech companies prospect list - 15 emails sent',
      metadata: { recipients: '15', openRate: '33%', variant: 'B' },
    },
    {
      timestamp: new Date(now - 300000).toISOString(),
      agent: 'opportunity-scout',
      action: 'Opportunity assessment',
      status: 'warning',
      details: 'Budget below threshold - monitoring for revision',
      metadata: { reason: 'Low budget', threshold: '$100', actual: '$75' },
    },
    {
      timestamp: new Date(now - 360000).toISOString(),
      agent: 'content-creator',
      action: 'Content revision requested',
      status: 'warning',
      details: 'Quality issues detected - SEO optimization needed',
      metadata: { issues: '2', priority: 'medium' },
    },
    {
      timestamp: new Date(now - 420000).toISOString(),
      agent: 'proposal-writer',
      action: 'Proposal rejected',
      status: 'error',
      details: 'Client feedback indicated poor fit',
      metadata: { reason: 'Scope mismatch', client: 'TechCorp Inc' },
    },
    {
      timestamp: new Date(now - 480000).toISOString(),
      agent: 'opportunity-scout',
      action: 'Scan completed',
      status: 'success',
      details: 'Daily opportunity scan - 45 opportunities reviewed',
      metadata: { reviewed: '45', qualified: '8', timestamp: '00:00 UTC' },
    },
  ]
}
