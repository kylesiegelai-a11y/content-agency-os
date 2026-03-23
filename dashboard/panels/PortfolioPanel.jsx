import React, { useState, useEffect } from 'react'

export default function PortfolioPanel({ token }) {
  const [portfolio, setPortfolio] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedItem, setSelectedItem] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    fetchPortfolio()
  }, [token])

  const fetchPortfolio = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/portfolio', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!response.ok) throw new Error('Failed to fetch portfolio')

      const data = await response.json()
      const items = data.items || data.samples || []
      setPortfolio(items.length > 0 ? items : getMockPortfolio())
      setError('')
    } catch (err) {
      setError(err.message)
      setPortfolio(getMockPortfolio())
    } finally {
      setLoading(false)
    }
  }

  const niches = ['all', 'HR', 'PEO', 'Benefits', 'Compliance', 'Technology']
  const filtered = portfolio.filter((item) => {
    const matchesNiche = filter === 'all' || item.niche === filter
    const matchesSearch =
      searchTerm === '' ||
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.excerpt.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesNiche && matchesSearch
  })

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
        <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">Portfolio</h2>
        <p className="text-[#9aa0a6]">Browsable collection of completed work samples</p>
      </div>

      {error && (
        <div className="kail-error">
          <p>Note: Displaying mock data - {error}</p>
        </div>
      )}

      {/* Search Bar */}
      <div>
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search portfolio..."
          className="kail-input"
        />
      </div>

      {/* Niche Filter */}
      <div className="kail-filter-group">
        {niches.map((niche) => (
          <button
            key={niche}
            onClick={() => setFilter(niche)}
            className={`kail-filter-button ${filter === niche ? 'active' : ''}`}
          >
            {niche}
          </button>
        ))}
      </div>

      {/* Portfolio Grid */}
      {selectedItem ? (
        <PortfolioItemDetail item={selectedItem} onClose={() => setSelectedItem(null)} />
      ) : (
        <>
          <div className="kail-portfolio-grid">
            {filtered.length === 0 ? (
              <div className="col-span-full kail-panel text-center py-12">
                <p className="text-[#9aa0a6]">No portfolio items found</p>
              </div>
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="kail-portfolio-item"
                >
                  <div className="kail-portfolio-header">
                    <h3 className="kail-portfolio-title">{item.title}</h3>
                    <div className="flex justify-between items-center mt-2">
                      <span className="kail-badge kail-badge-info">{item.niche}</span>
                      <span className="text-xs text-[#5f6368]">{item.wordCount} words</span>
                    </div>
                  </div>
                  <div className="kail-portfolio-body">
                    <p className="kail-portfolio-excerpt">{item.excerpt}</p>
                    <p className="kail-portfolio-date">
                      {new Date(item.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Items" value={portfolio.length} />
            <StatCard label="This Month" value={portfolio.filter((p) => {
              const date = new Date(p.date)
              const now = new Date()
              return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
            }).length} />
            <StatCard
              label="Total Words"
              value={(portfolio.reduce((sum, p) => sum + p.wordCount, 0) / 1000).toFixed(1) + 'k'}
            />
            <StatCard
              label="Avg Quality"
              value={(
                portfolio.reduce((sum, p) => sum + p.quality, 0) / portfolio.length
              ).toFixed(1)}
            />
          </div>
        </>
      )}
    </div>
  )
}

function PortfolioItemDetail({ item, onClose }) {
  return (
    <div className="kail-panel">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h2 className="text-2xl font-bold text-[#e8eaed]">{item.title}</h2>
          <div className="flex gap-2 mt-2">
            <span className="kail-badge kail-badge-info">{item.niche}</span>
            <span className="kail-badge kail-badge-success">Quality: {item.quality}/10</span>
          </div>
        </div>
        <button onClick={onClose} className="text-[#9aa0a6] hover:text-[#e8eaed] text-2xl">
          ✕
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-[#25292f] rounded p-3">
          <p className="text-xs text-[#5f6368]">Word Count</p>
          <p className="text-lg font-bold text-[#e8eaed]">{item.wordCount}</p>
        </div>
        <div className="bg-[#25292f] rounded p-3">
          <p className="text-xs text-[#5f6368]">Date</p>
          <p className="text-lg font-bold text-[#e8eaed]">
            {new Date(item.date).toLocaleDateString()}
          </p>
        </div>
        <div className="bg-[#25292f] rounded p-3">
          <p className="text-xs text-[#5f6368]">Client</p>
          <p className="text-lg font-bold text-[#e8eaed]">{item.client}</p>
        </div>
        <div className="bg-[#25292f] rounded p-3">
          <p className="text-xs text-[#5f6368]">Status</p>
          <p className="text-lg font-bold text-[#34a853]">✓ Delivered</p>
        </div>
      </div>

      <div className="kail-divider mb-6" />

      <div className="space-y-4">
        <div>
          <h3 className="font-bold text-[#e8eaed] mb-2">Content Preview</h3>
          <div className="bg-[#1a1f26] rounded p-4 max-h-96 overflow-y-auto">
            <p className="text-sm text-[#9aa0a6] font-mono leading-relaxed whitespace-pre-wrap">
              {item.content}
            </p>
          </div>
        </div>

        {item.metadata && (
          <div>
            <h3 className="font-bold text-[#e8eaed] mb-2">Metadata</h3>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(item.metadata).map(([key, value]) => (
                <div key={key} className="bg-[#25292f] rounded p-2">
                  <p className="text-xs text-[#5f6368]">{key}</p>
                  <p className="text-sm font-medium text-[#e8eaed]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button onClick={onClose} className="kail-button-outline w-full mt-6">
        Close
      </button>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="kail-metric text-center">
      <p className="text-3xl font-bold text-[#e8eaed]">{value}</p>
      <p className="text-xs text-[#9aa0a6] mt-1">{label}</p>
    </div>
  )
}

function getMockPortfolio() {
  return [
    {
      id: '1',
      title: 'The Complete Guide to HR Compliance in 2026',
      niche: 'HR',
      excerpt:
        'A comprehensive guide covering all aspects of HR compliance requirements for modern businesses. Includes updated regulations, best practices, and implementation strategies...',
      content: `The Complete Guide to HR Compliance in 2026

Chapter 1: Introduction
Human Resources compliance has become increasingly complex. Employers must navigate federal, state, and local regulations...

Chapter 2: Core Compliance Areas
2.1 Anti-Discrimination Laws
Under Title VII of the Civil Rights Act, employers cannot discriminate on the basis of race, color, religion, sex, or national origin...

Chapter 3: Documentation and Record Keeping
Proper documentation is essential for HR compliance...`,
      wordCount: 5200,
      quality: 9.1,
      client: 'TechCorp Inc',
      date: new Date(Date.now() - 7 * 86400000).toISOString(),
      metadata: {
        'SEO Keywords': '12',
        'Readability': 'Grade 10',
        'Sources': '8',
      },
    },
    {
      id: '2',
      title: 'PEO Services Comparison: ROI & Best Practices',
      niche: 'PEO',
      excerpt:
        'An in-depth analysis comparing top Professional Employer Organizations and their value propositions. Includes ROI calculations and case studies...',
      content: `PEO Services Comparison: ROI & Best Practices

Executive Summary
Professional Employer Organizations (PEOs) have become essential for mid-market companies seeking to optimize HR operations...

Section 1: Understanding PEOs
A PEO is a co-employment arrangement where a PEO becomes the employer of record for a client's employees...`,
      wordCount: 4100,
      quality: 8.8,
      client: 'Business Solutions LLC',
      date: new Date(Date.now() - 14 * 86400000).toISOString(),
      metadata: {
        'Analysis Depth': 'Comprehensive',
        'Case Studies': '3',
        'Data Points': '47',
      },
    },
    {
      id: '3',
      title: 'Employee Benefits Administration: Modern Approaches',
      niche: 'Benefits',
      excerpt:
        'Explores contemporary benefits administration strategies, including digital platforms, wellness programs, and employee engagement tactics...',
      content: `Employee Benefits Administration: Modern Approaches

Introduction
Modern benefits administration extends far beyond traditional health insurance. Today's employees expect comprehensive...

Part 1: Digital Transformation
1.1 Benefits Management Platforms
Modern benefits administration relies heavily on integrated platforms...`,
      wordCount: 3850,
      quality: 9.0,
      client: 'HR Innovations Group',
      date: new Date(Date.now() - 21 * 86400000).toISOString(),
      metadata: {
        'Tools Covered': '6',
        'Implementation Tips': '12',
        'Expert Quotes': '5',
      },
    },
    {
      id: '4',
      title: 'Compliance Checklist for Growing Tech Companies',
      niche: 'Compliance',
      excerpt:
        'A practical checklist for tech companies expanding operations. Covers employment law, equity compensation, and regulatory requirements...',
      content: `Compliance Checklist for Growing Tech Companies

Module 1: Foundation
☐ Establish clear employment policies
☐ Document hiring procedures
☐ Create employee handbook...

Module 2: Equity & Compensation
☐ Implement stock option plan
☐ Ensure proper ISOs classification...`,
      wordCount: 2950,
      quality: 8.7,
      client: 'StartupHub Partners',
      date: new Date(Date.now() - 28 * 86400000).toISOString(),
      metadata: {
        'Checklist Items': '34',
        'Sections': '5',
        'Updates': '2026 Edition',
      },
    },
    {
      id: '5',
      title: 'Executive Compensation Strategy & Tax Implications',
      niche: 'HR',
      excerpt:
        'Strategic guide to structuring executive compensation packages while optimizing tax efficiency. Includes deferred comp analysis...',
      content: `Executive Compensation Strategy & Tax Implications

I. Overview of Executive Compensation
Executive compensation serves multiple strategic purposes...

II. Salary & Bonus Structure
Basic salary and annual bonuses remain the foundation of compensation packages...`,
      wordCount: 4600,
      quality: 9.2,
      client: 'Executive Advisory Group',
      date: new Date(Date.now() - 35 * 86400000).toISOString(),
      metadata: {
        'Tax Scenarios': '8',
        'Compliance References': '12',
        'Case Examples': '4',
      },
    },
    {
      id: '6',
      title: 'Remote Work Compliance & Best Practices Guide',
      niche: 'Compliance',
      excerpt:
        'Comprehensive guide covering legal, compliance, and operational aspects of remote work arrangements. Includes state-by-state analysis...',
      content: `Remote Work Compliance & Best Practices Guide

Chapter 1: Legal Framework
Remote work introduces unique legal considerations...

Chapter 2: State-by-State Analysis
2.1 California
California labor law has specific provisions regarding remote workers...`,
      wordCount: 5400,
      quality: 8.9,
      client: 'National Chamber of Commerce',
      date: new Date(Date.now() - 42 * 86400000).toISOString(),
      metadata: {
        'States Covered': '15',
        'Scenarios': '20',
        'Resource Links': '18',
      },
    },
  ]
}
