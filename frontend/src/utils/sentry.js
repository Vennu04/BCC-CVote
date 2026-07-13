import * as Sentry from "@sentry/react";

// DSN is baked in at build time (Vite env vars are compile-time, not
// runtime) via the VITE_SENTRY_DSN build-arg in the CI pipeline — see
// Dockerfile and .github/workflows/prod-cd.yml. Local dev / any build
// without the secret set just runs without Sentry, silently.
export function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // Session Replay / tracing aren't wired up — this is deliberately just
    // error capture for now, matching what was actually asked for.
    tracesSampleRate: 0,
  });
}
