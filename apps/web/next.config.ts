import type { NextConfig } from "next";
const production = process.env.NODE_ENV === "production";
function origin(value: string | undefined): string { try { const u = new URL(value ?? ""); return ["https:", "http:"].includes(u.protocol) ? u.origin : ""; } catch { return ""; } }
const api = origin(process.env.NEXT_PUBLIC_API_URL || (production ? "" : "http://localhost:8000"));
const supabase = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
// Next hydration needs inline scripts. A nonce CSP is a separate release-hardening task.
const csp = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", `connect-src 'self' ${api} ${supabase} ${production ? "" : "ws://localhost:* ws://127.0.0.1:*"}`, "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"].join("; ");
const config: NextConfig = { output: "standalone", poweredByHeader: false, async headers() { return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }, { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, { key: "X-Frame-Options", value: "DENY" }, { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }] }]; } };
export default config;
