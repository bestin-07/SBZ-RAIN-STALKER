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
        go:      '#16A34A',
        wait:    '#CA8A04',
        stuck:   '#DC2626',
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
