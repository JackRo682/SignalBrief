import type { NextConfig } from "next";
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const apiOrigin = new URL(api).origin;
const supabaseOrigin = supabase ? new URL(supabase).origin : "";
const production = process.env.NODE_ENV === "production";
// Static deployment uses a conservative CSP. Inline hydration/styles are required by Next;
// this is not a nonce/strict-dynamic CSP. See docs/SECURITY.md for the hardening gate.
const csp = ["default-src 'self'", `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${supabaseOrigin} ${production ? "" : "ws://localhost:* ws://127.0.0.1:*"}`,
  "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'", "form-action 'self'"] .join("; ");
const config: NextConfig = {
  output: "standalone", poweredByHeader: false,
  async headers() { return [{ source: "/:path*", headers: [
    {key:"Content-Security-Policy",value:csp}, {key:"X-Content-Type-Options",value:"nosniff"},
    {key:"Referrer-Policy",value:"strict-origin-when-cross-origin"}, {key:"X-Frame-Options",value:"DENY"},
    {key:"Permissions-Policy",value:"camera=(), microphone=(), geolocation=()"},
  ]}]; },
};
export default config;
