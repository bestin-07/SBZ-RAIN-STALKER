/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:      '#08090B',
        surface: '#111318',
        border:  '#1E2128',
        dry:     '#D4A017',
        go:      '#16A34A',
        wait:    '#CA8A04',
        stuck:   '#DC2626',
        primary: '#F1F3F5',
        muted:   '#6B7280',
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
