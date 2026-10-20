export type AppEnv = 'production' | 'develop' | 'local';

const APP_ENVS: readonly AppEnv[] = ['production', 'develop', 'local'];

// Shared by server (process.env.APP_ENV) and client (import.meta.env.APP_ENV) — kept
// free of both so it runs in either runtime. An unset value resolves to 'local', not
// 'production': forgetting the variable in a non-prod deploy must never silently grant
// production behaviour (real emails, production Firebase project).
export function resolveAppEnv(raw: string | undefined): AppEnv {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return 'local';
  if ((APP_ENVS as readonly string[]).includes(value)) return value as AppEnv;
  throw new Error(`Invalid APP_ENV "${raw}". Expected one of: ${APP_ENVS.join(', ')}.`);
}
