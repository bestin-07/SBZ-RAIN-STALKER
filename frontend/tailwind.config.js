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
        // Theme-aware, like everything above — these used to be fixed dark-theme
        // hex literals (go/wait/stuck all read straight off the DARK palette,
        // unlike every other token in this file), so any element using the
        // `text-go`/`text-wait`/`border-stuck`/etc. utility classes stayed at
        // dark-mode brightness in light mode: ~2.1-2.3:1 contrast on the cream
        // background, the exact "vivid accent unreadable on cream" failure
        // index.css's :root/html.light split exists to prevent everywhere else
        // (GapBanner, RainRibbon and RadarMap all read var(--c-*) directly for
        // this reason). `dry` was always identical to `go` — same fix.
        dry:     'var(--c-go)',
        go:      'var(--c-go)',
        wait:    'var(--c-wait)',
        stuck:   'var(--c-stuck)',
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
