/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      'var(--c-bg)',
        surface: 'var(--c-surface)',
        border:  'var(--c-border)',
        primary: 'var(--c-primary)',
        muted:   'var(--c-muted)',
        dry:     '#D4A017',
        go:      '#D4A017',
        wait:    '#1BAEE2',
        stuck:   '#0077AA',
      },
      fontFamily: {
        sans:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'Menlo', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
