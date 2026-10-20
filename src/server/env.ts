import { resolveAppEnv } from '../lib/appEnv.js';

// Must be imported after `dotenv/config` has run (server.ts and api/index.ts both load
// it first), since this reads process.env at module evaluation time.
export const appEnv = resolveAppEnv(process.env.APP_ENV);
export const isProduction = appEnv === 'production';
