import "dotenv/config";
import { createApp } from "../src/server/app";

// Vercel serverless entry point. Every request under /api/* is routed here
// (see the rewrite in vercel.json) and handled by the same Express app used
// in local dev — Express apps are valid (req, res) handlers, so no adapter
// is needed. Static assets and the SPA fallback are served by Vercel itself
// from the Vite build output, not by this function.
const app = createApp();

export default app;
