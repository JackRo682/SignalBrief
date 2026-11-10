import type { NextConfig } from "next";
import { resolve } from "node:path";
// Node source relays share the same pure validators as the Edge collectors.
const repositoryRoot = resolve(__dirname, "../..");
const production = process.env.NODE_ENV === "production";
function origin(value: string | undefined): string { try { const u = new URL(value ?? ""); return ["https:", "http:"].includes(u.protocol) ? u.origin : ""; } catch { return ""; } }
const api = origin(process.env.NEXT_PUBLIC_API_URL || (production ? "" : "http://localhost:8000"));
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
// Next hydration needs inline scripts. A nonce CSP is a separate release-hardening task.
const googleAnalytics = /^G-[A-Z0-9]+$/.test(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "");
const csp = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${googleAnalytics ? " https://www.googletagmanager.com/gtag/" : ""} https://s3.tradingview.com/external-embedding/embed-widget-timeline.js https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js https://s3.tradingview.com/external-embedding/embed-widget-symbol-profile.js https://s3.tradingview.com/external-embedding/embed-widget-financials.js${production ? "" : " 'unsafe-eval'"}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", `connect-src 'self' ${api} ${supabase}${googleAnalytics ? " https://www.google-analytics.com https://region1.google-analytics.com" : ""} ${production ? "" : "ws://localhost:* ws://127.0.0.1:*"}`, "frame-src https://www.tradingview-widget.com", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; ");
// The development status badge overlaps the mobile Home tab during CI clicks.
// Next still surfaces compile/runtime error overlays when this indicator is off.
const config: NextConfig = { output: "standalone", outputFileTracingRoot: repositoryRoot, turbopack: { root: repositoryRoot }, poweredByHeader: false, ...(!production && process.env.CI === "true" ? {devIndicators: false as const} : {}), async headers() { return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, { key: "X-Frame-Options", value: "DENY" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }] }]; } };
export default config;
