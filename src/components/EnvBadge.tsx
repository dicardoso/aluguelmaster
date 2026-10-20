import { resolveAppEnv } from '../lib/appEnv';

const LABELS = {
  develop: { text: 'HOMOLOGAÇÃO', className: 'bg-amber-500 text-black' },
  local: { text: 'LOCAL', className: 'bg-purple-600 text-white' },
} as const;

// Corner marker shown everywhere except production so a test session can't be
// mistaken for the real system.
export function EnvBadge() {
  const env = resolveAppEnv(import.meta.env.APP_ENV);
  if (env === 'production') return null;
  const { text, className } = LABELS[env];
  return (
    <div
      className={`fixed bottom-3 left-3 z-[60] pointer-events-none rounded-full px-3 py-1 text-xs font-bold tracking-wide shadow-lg ${className}`}
    >
      {text}
    </div>
  );
}
