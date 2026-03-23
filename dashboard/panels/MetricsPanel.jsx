import React, { useState, useEffect } from 'react'

export default function MetricsPanel({ token }) {
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchMetrics()
  }, [token])

  const fetchMetrics = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/metrics', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error('Failed to fetch metrics')

      const data = await response.json()
      // Validate that response has expected fields, otherwise use mock
      if (data && typeof data.totalEarnings === 'number') {
        setMetrics(data)
      } else {
        setMetrics(getMockMetrics())
      }
      setError('')
    } catch (err) {
      setError(err.message)
      // Mock data fallback
      setMetrics(getMockMetrics())
    } finally {
      setLoading(false)
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

  if (!metrics) {
    return (
      <div className="kail-panel text-center py-12">
        <p className="text-[#ea4335]">Failed to load metrics</p>
      </div>
    )
  }

  const budget = metrics.monthlyBudget
  const spent = metrics.apiCost
  const budgetPercentage = (spent / budget) * 100
  const budgetStatus =
    budgetPercentage > 95
      ? 'critical'
      : budgetPercentage > 80
        ? 'warning'
        : 'healthy'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">Metrics Dashboard</h2>
        <p className="text-[#9aa0a6]">Key performance indicators and financial metrics</p>
      </div>

      {error && (
        <div className="kail-error">
          <p>Note: Displaying mock data - {error}</p>
        </div>
      )}

      {/* Primary Metrics Grid */}
      <div className="kail-grid">
        <MetricCard
          label="Jobs Completed"
          value={metrics.jobsCompleted}
          unit=""
          trend={`+${metrics.jobsCompletedTrend} this month`}
          icon="✓"
        />
        <MetricCard
          label="Total Earnings"
          value={`$${metrics.totalEarnings.toLocaleString()}`}
          unit=""
          trend={`+${metrics.earningsTrend}% vs last month`}
          icon="💰"
        />
        <MetricCard
          label="Pipeline Value"
          value={`$${metrics.pipelineValue.toLocaleString()}`}
          unit=""
          trend={`${metrics.pipelineTrend} proposals`}
          icon="📈"
        />
        <MetricCard
          label="Win Rate"
          value={`${metrics.winRate}%`}
          unit=""
          trend="Of all proposals"
          icon="🎯"
        />
        <MetricCard
          label="Average Job Value"
          value={`$${metrics.avgJobValue.toLocaleString()}`}
          unit=""
          trend="Per completed job"
          icon="💵"
        />
        <MetricCard
          label="Active Clients"
          value={metrics.activeClients}
          unit=""
          trend={`${metrics.newClients} new`}
          icon="👥"
        />
      </div>

      {/* Budget and API Cost */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BudgetCard
          spent={spent}
          budget={budget}
          percentage={budgetPercentage}
          status={budgetStatus}
        />

        <div className="kail-metric">
          <div className="flex justify-between items-start">
            <div>
              <p className="kail-metric-label">API Cost This Month</p>
              <p className="kail-metric-value">${spent.toFixed(2)}</p>
              <p className="text-xs text-[#9aa0a6] mt-2">
                Average: ${(spent / metrics.jobsCompleted).toFixed(2)} per job
              </p>
            </div>
            <span className="text-3xl">⚙️</span>
          </div>
          <div className="kail-metric-bar mt-4">
            <div className="kail-metric-fill" style={{ width: `${Math.min(100, budgetPercentage)}%` }} />
          </div>
        </div>
      </div>

      {/* Detailed Metrics */}
      <div className="kail-metric">
        <h3 className="font-bold text-[#e8eaed] mb-4">Financial Summary</h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-[#9aa0a6]">Total Revenue</span>
            <span className="font-bold text-[#34a853]">${metrics.totalEarnings.toLocaleString()}</span>
          </div>
          <div className="kail-divider" />
          <div className="flex justify-between items-center">
            <span className="text-[#9aa0a6]">API Costs</span>
            <span className="font-bold text-[#fbbc04]">-${spent.toFixed(2)}</span>
          </div>
          <div className="kail-divider" />
          <div className="flex justify-between items-center">
            <span className="text-[#9aa0a6]">Other Costs</span>
            <span className="font-bold text-[#fbbc04]">-${metrics.otherCosts.toFixed(2)}</span>
          </div>
          <div className="kail-divider" />
          <div className="flex justify-between items-center pt-2">
            <span className="font-bold text-[#e8eaed]">Net Profit</span>
            <span className="font-bold text-[#34a853] text-lg">
              ${metrics.netProfit.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Profit Margin Chart */}
      <div className="kail-metric">
        <h3 className="font-bold text-[#e8eaed] mb-4">Profit Margin</h3>
        <div className="flex items-end gap-2 h-32">
          {[
            { label: 'Revenue', value: metrics.totalEarnings, color: 'bg-[#34a853]' },
            { label: 'Costs', value: spent + metrics.otherCosts, color: 'bg-[#ea4335]' },
            { label: 'Profit', value: metrics.netProfit, color: 'bg-[#1a73e8]' },
          ].map((item, idx) => {
            const maxValue = metrics.totalEarnings
            const height = (item.value / maxValue) * 100
            return (
              <div key={idx} className="flex-1 flex flex-col items-center">
                <div className="text-right text-xs font-bold text-[#e8eaed] mb-2">
                  ${item.value.toFixed(0)}
                </div>
                <div className={`w-full ${item.color}`} style={{ height: `${height}%` }} />
                <p className="text-xs text-[#9aa0a6] mt-2">{item.label}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Budget Health Status */}
      <div className="kail-panel">
        <h3 className="font-bold text-[#e8eaed] mb-4">Budget Status</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#9aa0a6]">Monthly Budget Usage</p>
            <p className="text-2xl font-bold text-[#e8eaed] mt-2">
              {budgetPercentage.toFixed(1)}%
            </p>
          </div>
          <div
            className={`px-4 py-2 rounded-lg font-medium ${
              budgetStatus === 'critical'
                ? 'bg-[#ea4335] bg-opacity-20 text-[#f8b4b0]'
                : budgetStatus === 'warning'
                  ? 'bg-[#fbbc04] bg-opacity-20 text-[#f9d574]'
                  : 'bg-[#34a853] bg-opacity-20 text-[#81c995]'
            }`}
          >
            {budgetStatus === 'critical'
              ? '🔴 Critical'
              : budgetStatus === 'warning'
                ? '🟡 Warning'
                : '🟢 Healthy'}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ label, value, unit, trend, icon }) {
  return (
    <div className="kail-metric">
      <div className="flex justify-between items-start">
        <div>
          <p className="kail-metric-label">{label}</p>
          <p className="kail-metric-value">{value}</p>
          <p className="text-xs text-[#9aa0a6] mt-1">{trend}</p>
        </div>
        <span className="text-3xl">{icon}</span>
      </div>
    </div>
  )
}

function BudgetCard({ spent, budget, percentage, status }) {
  return (
    <div className="kail-metric">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="kail-metric-label">Monthly Budget</p>
          <p className="kail-metric-value">${spent.toFixed(2)}</p>
          <p className="text-xs text-[#9aa0a6] mt-2">of ${budget} limit</p>
        </div>
        <span className="text-3xl">💳</span>
      </div>
      <div className="kail-metric-bar">
        <div
          className="kail-metric-fill"
          style={{
            width: `${Math.min(100, percentage)}%`,
            backgroundImage:
              percentage > 95
                ? 'linear-gradient(to right, #ea4335, #d33427)'
                : percentage > 80
                  ? 'linear-gradient(to right, #fbbc04, #f9ab00)'
                  : 'linear-gradient(to right, #1a73e8, #34a853)',
          }}
        />
      </div>
      <p className="text-xs text-[#9aa0a6] mt-3">
        ${(budget - spent).toFixed(2)} remaining
      </p>
    </div>
  )
}

function getMockMetrics() {
  return {
    jobsCompleted: 24,
    jobsCompletedTrend: 8,
    totalEarnings: 8500,
    earningsTrend: 35,
    pipelineValue: 15000,
    pipelineTrend: '12 active',
    winRate: 76,
    avgJobValue: 354,
    activeClients: 8,
    newClients: 2,
    monthlyBudget: 500,
    apiCost: 287.45,
    otherCosts: 125.5,
    netProfit: 8087.05,
  }
}
