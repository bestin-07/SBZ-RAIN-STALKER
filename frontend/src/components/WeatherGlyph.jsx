import { weatherGroup } from '../gaps'

// Drawn weather-code glyphs (v2.30). Deliberately NOT emoji: the emoji sets for
// ⛈/🌦/🌧 diverge badly across iOS and Android builds — some render a flat
// monochrome box — and this app is mostly phones. Same call, same reason, as the
// crossed-activity ring in index.css (a CSS overlay rather than U+20E0).
//
// Every stroke takes a theme token, so a glyph reads correctly on cream and on
// near-black without a second palette: the sun is the GO gold, rain is the WAIT
// blue, snow the light blue, lightning the alert amber, cloud the muted grey.
const P = { fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

const CLOUD = 'M6.4 13.6h10.4a3.5 3.5 0 0 0 .3-7 5.1 5.1 0 0 0-9.8 1 3.2 3.2 0 0 0-.9 6Z'

const SHAPES = {
  clear: (
    <g stroke="var(--c-go)" {...P}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </g>
  ),
  partly: (
    <g {...P}>
      <g stroke="var(--c-go)">
        <circle cx="8.6" cy="8.2" r="3.1" />
        <path d="M8.6 1.9v1.6M2.3 8.2h1.6M4.1 3.7l1.2 1.2M13.1 3.7l-1.2 1.2" />
      </g>
      <path d="M7.4 19.4h9.9a3.3 3.3 0 0 0 .3-6.6 4.8 4.8 0 0 0-9.2.9 3 3 0 0 0-1 5.7Z" stroke="var(--c-muted)" />
    </g>
  ),
  cloudy: (
    <g {...P}>
      <path d="M6.4 18.6h10.4a3.5 3.5 0 0 0 .3-7 5.1 5.1 0 0 0-9.8 1 3.2 3.2 0 0 0-.9 6Z" stroke="var(--c-muted)" />
    </g>
  ),
  fog: (
    <g {...P}>
      <path d={CLOUD} stroke="var(--c-muted)" />
      <path d="M4.5 17.4h15M7 20.6h11" stroke="var(--c-muted)" />
    </g>
  ),
  drizzle: (
    <g {...P}>
      <path d="M6.4 14.4h10.4a3.5 3.5 0 0 0 .3-7 5.1 5.1 0 0 0-9.8 1 3.2 3.2 0 0 0-.9 6Z" stroke="var(--c-muted)" />
      <path d="M9.4 18v1.8M14.6 18v1.8" stroke="var(--c-light)" />
    </g>
  ),
  rain: (
    <g {...P}>
      <path d={CLOUD} stroke="var(--c-muted)" />
      <path d="M8.4 16.6l-1 3.4M12 16.6l-1 3.4M15.6 16.6l-1 3.4" stroke="var(--c-wait)" />
    </g>
  ),
  showers: (
    <g {...P}>
      <g stroke="var(--c-go)">
        <circle cx="7.6" cy="6.6" r="2.6" />
        <path d="M7.6 1.4v1.3M2.6 6.6h1.3M3.9 2.9l.9.9" />
      </g>
      <path d="M7.9 15.4h9a3.2 3.2 0 0 0 .3-6.4 4.7 4.7 0 0 0-8.9.9 2.9 2.9 0 0 0-.4 5.5Z" stroke="var(--c-muted)" />
      <path d="M10 18.2l-.9 2.9M14.2 18.2l-.9 2.9" stroke="var(--c-wait)" />
    </g>
  ),
  snow: (
    <g {...P}>
      <path d={CLOUD} stroke="var(--c-muted)" />
      <g stroke="var(--c-light)">
        <path d="M9.2 17.4v3M7.8 18.2l2.8 1.4M10.6 18.2l-2.8 1.4" />
        <path d="M15 17.4v3M13.6 18.2l2.8 1.4M16.4 18.2l-2.8 1.4" />
      </g>
    </g>
  ),
  thunder: (
    <g {...P}>
      <path d={CLOUD} stroke="var(--c-muted)" />
      <path d="M12.8 16.2l-3 3.6h2.6l-.9 2.6 3.1-3.8h-2.6Z" stroke="var(--c-alert)" />
    </g>
  ),
}

// `code` is a raw WMO weather code; an unknown or missing one renders nothing at
// all rather than a guessed glyph — a wrong sky icon is worse than no sky icon.
export default function WeatherGlyph({ code, size = 22, label = null }) {
  const group = weatherGroup(code)
  if (!group) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="shrink-0"
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
      focusable="false"
    >
      {SHAPES[group]}
    </svg>
  )
}
