import { describe, expect, it } from "vitest";
import { assertRuntimeAuth, localDemoAllowed } from "../src/lib/auth-policy";

const live = { demo_mode: false, demo_admin_enabled: false, auth_mode: "supabase" as const };
const demo = { demo_mode: true, demo_admin_enabled: true, auth_mode: "demo" as const };
describe("public authentication fails closed", () => {
  it.each(["signalbrief.vercel.app", "example.com"])("rejects demo auth on %s", hostname => {
    expect(() => assertRuntimeAuth(demo, hostname, true, "https://api.example.com", "https://project.supabase.co", "public-key")).toThrow();
    expect(localDemoAllowed(hostname, false)).toBe(false);
  });
  it.each(["", "http://localhost:8000", "http://api.example.com"])("rejects missing or insecure API %s", api => {
    expect(() => assertRuntimeAuth(live, "example.com", true, api, "https://project.supabase.co", "public-key")).toThrow();
  });
  it("rejects production demo even on loopback", () => {
    expect(() => assertRuntimeAuth(demo, "127.0.0.1", true, "http://127.0.0.1:8000", undefined, undefined)).toThrow();
  });
  it("rejects missing Supabase and demo admin in live config", () => {
    expect(() => assertRuntimeAuth(live, "example.com", true, "https://api.example.com", undefined, undefined)).toThrow();
    expect(() => assertRuntimeAuth({ ...live, demo_admin_enabled: true }, "example.com", true, "https://api.example.com", "https://project.supabase.co", "public-key")).toThrow();
  });
  it("permits explicitly configured live auth and private development demo", () => {
    expect(() => assertRuntimeAuth(live, "example.com", true, "https://api.example.com", "https://project.supabase.co", "public-key")).not.toThrow();
    expect(() => assertRuntimeAuth(demo, "127.0.0.1", false, "http://127.0.0.1:8000", undefined, undefined)).not.toThrow();
  });
});
