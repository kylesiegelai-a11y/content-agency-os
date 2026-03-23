import React, { useState } from 'react'

export default function Login({ onLogin, error, loading }) {
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!password) {
      setLocalError('Password is required')
      return
    }
    setLocalError('')
    onLogin(password)
  }

  return (
    <div className="min-h-screen bg-[#0f1419] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo and Branding */}
        <div className="text-center mb-8">
          <div className="inline-block bg-gradient-to-r from-[#1a73e8] to-[#34a853] bg-clip-text text-transparent mb-4">
            <h1 className="text-5xl font-bold">KAIL</h1>
          </div>
          <h2 className="text-2xl font-bold text-[#e8eaed] mb-2">
            Content Agency OS
          </h2>
          <p className="text-[#9aa0a6]">
            Automated Content Creation & Management System
          </p>
        </div>

        {/* Login Card */}
        <form onSubmit={handleSubmit} className="kail-panel space-y-6">
          <div className="text-center mb-6">
            <p className="text-sm text-[#9aa0a6]">
              Enter master password to access the dashboard
            </p>
          </div>

          {/* Error Messages */}
          {(error || localError) && (
            <div className="kail-error">
              <p className="font-medium text-sm">{error || localError}</p>
            </div>
          )}

          {/* Password Input */}
          <div>
            <label className="block text-sm font-medium text-[#e8eaed] mb-2">
              Master Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setLocalError('')
              }}
              placeholder="Enter your master password"
              className="kail-input"
              disabled={loading}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className={`w-full kail-button-primary font-medium py-3 ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Authenticating...
              </span>
            ) : (
              'Access Dashboard'
            )}
          </button>

          {/* Footer Info */}
          <div className="text-center text-xs text-[#5f6368] pt-4 border-t border-[#3c4043]">
            <p>Secure authentication required</p>
            <p className="mt-1">JWT tokens expire after 24 hours</p>
          </div>
        </form>

        {/* System Status */}
        <div className="mt-6 text-center">
          <div className="inline-block px-4 py-2 bg-[#25292f] rounded border border-[#3c4043]">
            <p className="text-xs text-[#9aa0a6]">
              <span className="inline-block w-2 h-2 bg-[#34a853] rounded-full mr-2" />
              System Status: Operational
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
