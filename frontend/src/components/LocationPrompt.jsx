export default function LocationPrompt({ onRequest, error, loading }) {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-start justify-center px-6 pb-safe">
      <div className="mb-12">
        <div className="font-display font-bold text-3xl text-primary tracking-[0.15em] uppercase mb-1">
          SBZ RAIN STALKER
        </div>
        <div className="font-mono text-sm text-muted">
          find the gaps. step out when it counts.
        </div>
      </div>

      <div className="mb-10 space-y-2">
        <Fact n="01" text="reads radar data updated every 5 minutes" />
        <Fact n="02" text="finds dry windows at your exact location" />
        <Fact n="03" text="tracks how accurate the forecast actually is" />
      </div>

      {error && (
        <div className="font-mono text-xs text-stuck mb-6 border border-stuck px-3 py-2">
          {error}. tap below to try again.
        </div>
      )}

      <button
        onClick={onRequest}
        disabled={loading}
        className="font-display font-bold text-sm tracking-[0.15em] uppercase px-8 py-4 bg-primary text-bg hover:bg-dry transition-colors disabled:opacity-40"
      >
        {loading ? 'LOCATING' : 'GET MY LOCATION'}
      </button>

      <div className="font-mono text-xs text-muted mt-4 max-w-xs leading-relaxed">
        location stays in your browser. nothing is stored on our end.
      </div>
    </div>
  )
}

function Fact({ n, text }) {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-xs text-muted shrink-0 mt-0.5">{n}</span>
      <span className="font-mono text-xs text-muted">{text}</span>
    </div>
  )
}
