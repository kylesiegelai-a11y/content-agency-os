import { useState, useEffect } from 'react'

const FORMAT_LABELS = {
  markdown: 'Markdown',
  pdf: 'PDF',
  html: 'HTML',
  google_docs: 'Google Docs'
}

const FORMAT_COLORS = {
  markdown: 'bg-gray-700/30 text-gray-300 border-gray-600',
  pdf: 'bg-red-900/30 text-red-400 border-red-800',
  html: 'bg-blue-900/30 text-blue-400 border-blue-800',
  google_docs: 'bg-green-900/30 text-green-400 border-green-800'
}

export default function DeliveriesPanel({ token }) {
  const [config, setConfig] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFormats, setPreviewFormats] = useState(['markdown', 'html', 'pdf'])
  const [previewTitle, setPreviewTitle] = useState('Sample Blog Post')
  const [previewBody, setPreviewBody] = useState('## Introduction\n\nThis is a preview of how your deliverables will look when sent to clients.\n\n## Key Points\n\n- Point one about the topic\n- Point two with supporting evidence\n- Point three with actionable advice\n\n## Conclusion\n\nSummarize the key takeaways here.')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/delivery/config', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) throw new Error('Failed to fetch delivery config')
      const data = await response.json()
      setConfig(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const toggleFormat = (fmt) => {
    setPreviewFormats(prev =>
      prev.includes(fmt)
        ? prev.filter(f => f !== fmt)
        : [...prev, fmt]
    )
  }

  const runPreview = async () => {
    if (previewFormats.length === 0) {
      setError('Select at least one format')
      setTimeout(() => setError(null), 3000)
      return
    }
    setPreviewLoading(true)
    setPreviewResult(null)
    setError(null)
    try {
      const response = await fetch('/api/delivery/preview', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: previewTitle,
          body: previewBody,
          formats: previewFormats
        })
      })
      if (!response.ok) throw new Error('Preview generation failed')
      const data = await response.json()
      setPreviewResult(data.results)
    } catch (err) {
      setError(err.message)
      setTimeout(() => setError(null), 3000)
    } finally {
      setPreviewLoading(false)
    }
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
      {/* Supported Formats Overview */}
      <div className="kail-panel">
        <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Delivery Formats</h2>
        <p className="text-sm text-[#9aa0a6] mb-4">
          Content can be delivered in multiple formats. Configure per-job or per-client delivery preferences.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {config?.supportedFormats?.map(fmt => (
            <div key={fmt} className="bg-[#1e2228] rounded-lg p-4 border border-[#303438] text-center">
              <div className="text-2xl mb-2">
                {fmt === 'markdown' && '📝'}
                {fmt === 'pdf' && '📄'}
                {fmt === 'html' && '🌐'}
                {fmt === 'google_docs' && '📑'}
              </div>
              <p className="text-sm font-medium text-[#e8eaed]">{FORMAT_LABELS[fmt] || fmt}</p>
              <p className="text-xs text-[#9aa0a6] mt-1">
                {fmt === 'markdown' && 'Source file for CMS import'}
                {fmt === 'pdf' && 'Branded document for clients'}
                {fmt === 'html' && 'Web-ready with styling'}
                {fmt === 'google_docs' && 'Collaborative editing'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Branding Info */}
      <div className="kail-panel">
        <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Branding</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold"
                   style={{ background: config?.defaultBrand?.primaryColor, color: '#fff' }}>
                {config?.defaultBrand?.logoText}
              </div>
              <div>
                <p className="text-sm font-medium text-[#e8eaed]">Default Brand</p>
                <p className="text-xs text-[#9aa0a6]">{config?.defaultBrand?.companyName}</p>
              </div>
            </div>
            <p className="text-xs text-[#9aa0a6]">{config?.defaultBrand?.tagline}</p>
            <div className="flex gap-2 mt-3">
              <div className="w-6 h-6 rounded" style={{ background: config?.defaultBrand?.primaryColor }} title="Primary"></div>
              <div className="w-6 h-6 rounded" style={{ background: config?.defaultBrand?.secondaryColor }} title="Secondary"></div>
              <div className="w-6 h-6 rounded" style={{ background: config?.defaultBrand?.accentColor }} title="Accent"></div>
            </div>
          </div>
          <div className="bg-[#1e2228] rounded-lg p-4 border border-[#303438]">
            <p className="text-sm font-medium text-[#e8eaed] mb-2">White-Label Support</p>
            <p className="text-xs text-[#9aa0a6] mb-3">
              Set <code className="bg-[#25292f] px-1 py-0.5 rounded text-[#81c995]">client.whiteLabel: true</code> and
              provide <code className="bg-[#25292f] px-1 py-0.5 rounded text-[#81c995]">client.brand</code> in the job config
              to deliver with the client's own branding instead.
            </p>
            <p className="text-xs text-[#9aa0a6]">
              Brand fields: companyName, tagline, logoText, primaryColor, secondaryColor, accentColor, website, footerText
            </p>
          </div>
        </div>
      </div>

      {/* Preview Generator */}
      <div className="kail-panel">
        <h2 className="text-lg font-bold text-[#e8eaed] mb-4">Preview Generator</h2>
        <p className="text-sm text-[#9aa0a6] mb-4">
          Test delivery formats with sample content before sending to clients.
        </p>

        {error && (
          <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 rounded mb-4 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Format selection */}
          <div>
            <label className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wide mb-2 block">Formats</label>
            <div className="flex flex-wrap gap-2">
              {config?.supportedFormats?.map(fmt => (
                <button
                  key={fmt}
                  onClick={() => toggleFormat(fmt)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-all ${
                    previewFormats.includes(fmt)
                      ? FORMAT_COLORS[fmt] || 'bg-[#1a73e8] text-white border-[#1a73e8]'
                      : 'bg-[#25292f] text-[#5f6368] border-[#303438]'
                  }`}
                >
                  {FORMAT_LABELS[fmt] || fmt}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wide mb-2 block">Title</label>
            <input
              type="text"
              value={previewTitle}
              onChange={(e) => setPreviewTitle(e.target.value)}
              className="w-full bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] focus:outline-none focus:border-[#1a73e8]"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-xs font-medium text-[#9aa0a6] uppercase tracking-wide mb-2 block">Content (Markdown)</label>
            <textarea
              value={previewBody}
              onChange={(e) => setPreviewBody(e.target.value)}
              rows={6}
              className="w-full bg-[#1e2228] border border-[#303438] rounded-lg px-4 py-2 text-sm text-[#e8eaed] font-mono focus:outline-none focus:border-[#1a73e8]"
            />
          </div>

          <button
            onClick={runPreview}
            disabled={previewLoading}
            className={`px-6 py-2 rounded-lg font-medium text-sm transition-colors ${
              previewLoading
                ? 'bg-[#1557b0] text-white opacity-70 cursor-wait'
                : 'bg-[#1a73e8] hover:bg-[#1557b0] text-white'
            }`}
          >
            {previewLoading ? 'Generating...' : 'Generate Preview'}
          </button>
        </div>

        {/* Preview results */}
        {previewResult && (
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-bold text-[#e8eaed]">Generated Files</h3>
            {previewResult.map((result, i) => (
              <div key={i} className="bg-[#1e2228] rounded-lg p-4 border border-[#303438] flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium border ${FORMAT_COLORS[result.format] || 'bg-gray-700/30 text-gray-300 border-gray-600'}`}>
                    {FORMAT_LABELS[result.format] || result.format}
                  </span>
                  <span className="text-sm text-[#e8eaed]">{result.filename || result.title || result.documentId || '—'}</span>
                </div>
                <div className="text-xs text-[#9aa0a6]">
                  {result.status === 'failed' ? (
                    <span className="text-red-400">{result.error}</span>
                  ) : result.size ? (
                    `${(result.size / 1024).toFixed(1)} KB`
                  ) : (
                    result.url ? 'Ready' : '—'
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
