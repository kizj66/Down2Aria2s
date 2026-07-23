export default {
  content: ['./src/**/*.tsx', './index.html', './confirm/**/*.tsx', './confirm/index.html'],
  theme: {
    extend: {
      colors: {
        // 新配色：深蓝青系
        'app-bg': '#0f172a',
        'app-card': '#1e293b',
        'app-card-hover': '#334155',
        'app-border': '#334155',
        primary: '#3b82f6',
        'primary-dark': '#2563eb',
        accent: '#06b6d4',
        success: '#22c55e',
        error: '#ef4444',
        warning: '#eab308',
        muted: '#64748b',
      },
      textColor: {
        'app-primary': '#f1f5f9',
        'app-secondary': '#94a3b8',
        'app-muted': '#64748b',
      },
      fontSize: {
        xxl: '10rem',
      },
      height: {
        'calc-14': 'calc(100% - 5rem)',
        108: '30rem',
      },
      width: {
        86: '22rem',
        'calc-grow': 'calc(22rem - 7.5rem)',
      },
    },
  },
  plugins: [],
}
