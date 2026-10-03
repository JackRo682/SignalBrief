// @vitest-environment node
import { afterEach,beforeEach,describe,it,expect,vi } from "vitest";
import type { NextRequest } from "next/server";
import { GET,DELETE,POST } from "../src/app/api/[...path]/route";
function req(path:string,init:RequestInit={}):NextRequest {const r=new Request(`https://app.example/api/${path}`,init);return Object.assign(r,{nextUrl:new URL(r.url)}) as NextRequest;}
const params=(path:string)=>({params:Promise.resolve({path:path.split("/")})});
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://test-project.supabase.co");vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY","public-test-key");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("same-origin API proxy",()=>{
 it("forwards bearer but not cookies and never caches user data",async()=>{const fetcher=vi.fn().mockResolvedValue(new Response('{"id":"own-user"}',{headers:{"content-type":"application/json","set-cookie":"DO_NOT_FORWARD=1"}}));vi.stubGlobal("fetch",fetcher);const response=await GET(req("v1/me",{headers:{authorization:"Bearer test-token",cookie:"private-cookie=1"}}),params("v1/me"));expect(response.status).toBe(200);const [url,init]=fetcher.mock.calls[0];expect(url.href).toBe("https://test-project.supabase.co/functions/v1/signalbrief-api/v1/me");expect(init.headers.get("Authorization")).toBe("Bearer test-token");expect(init.headers.get("Cookie")).toBeNull();expect(response.headers.get("Cache-Control")).toContain("no-store");expect(response.headers.get("Set-Cookie")).toBeNull();});
 it("allows an empty DELETE without a content-type header",async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:204})));expect((await DELETE(req("v1/calendar/abc",{method:"DELETE"}),params("v1/calendar/abc"))).status).toBe(204);});
 it("rejects non-JSON bodies",async()=>{expect((await POST(req("v1/me",{method:"POST",body:"not-json"}),params("v1/me"))).status).toBe(415);});
 it("bounds streaming bodies even without Content-Length",async()=>{expect((await POST(req("v1/me",{method:"POST",body:'"'+"x".repeat(131073)+'"',headers:{"content-type":"application/json"}}),params("v1/me"))).status).toBe(413);});
 it("rejects arbitrary forwarding paths",async()=>{expect((await GET(req("v1/unknown"),params("v1/unknown"))).status).toBe(404);});
 it("rejects non-Supabase targets",async()=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://evil.example");expect((await GET(req("v1/me"),params("v1/me"))).status).toBe(503);});
 it("rejects URL credentials",async()=>{vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://user:secret@test-project.supabase.co");expect((await GET(req("v1/me"),params("v1/me"))).status).toBe(503);});
 it("does not reflect network internals",async()=>{vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("secret-in-exception")));const r=await GET(req("v1/me"),params("v1/me"));expect(r.status).toBe(502);expect(await r.text()).not.toContain("secret-in-exception");});
});
