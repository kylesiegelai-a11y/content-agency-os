/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './dashboard/index.html',
    './dashboard/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        kail: {
          primary: '#1a73e8',
          'primary-dark': '#1557b0',
          success: '#34a853',
          warning: '#fbbc04',
          danger: '#ea4335',
          'bg-dark': '#0f1419',
          'bg-darker': '#080a0f',
          surface: '#1a1f26',
          'surface-light': '#25292f',
          'text-primary': '#e8eaed',
          'text-secondary': '#9aa0a6',
          border: '#3c4043',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Fira Code', 'Monaco', 'monospace'],
      },
    },
  },
  plugins: [],
}
