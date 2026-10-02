import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { request,externalUrl,APIError,body,errorMessage } from "../src/lib/api";
afterEach(()=>vi.unstubAllGlobals());
describe("API contracts",()=>{
 it("sends a bearer token without cookies and validates response",async()=>{
  const mock=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"ok"}),{status:200}));vi.stubGlobal("fetch",mock);
  expect(await request("/v1/me","token",z.object({id:z.string()}))).toEqual({id:"ok"});
  expect(mock.mock.calls[0][1].credentials).toBe("omit");expect(mock.mock.calls[0][1].headers.Authorization).toBe("Bearer token");
 });
 it("rejects malformed API output",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({id:12}),{status:200})));
  await expect(request("/v1/me",null,z.object({id:z.string()}))).rejects.toBeInstanceOf(z.ZodError);
 });
 it("does not let the caller redirect tokens to an absolute URL",async()=>{
  await expect(request("https://evil.test", "token", z.unknown())).rejects.toThrow("relative_api_path_required");
  await expect(request("//evil.test", "token", z.unknown())).rejects.toThrow();
 });
 it("propagates expiration as a structured error",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(JSON.stringify({detail:"expired"}),{status:401,headers:{"x-request-id":"r-1"}})));
  await expect(request("/v1/me","old",z.unknown())).rejects.toMatchObject({status:401,requestId:"r-1"});
 });
 it("accepts an empty 204 response",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:204})));
  expect(await request("/v1/items/a","token",z.undefined(),body("DELETE"))).toBeUndefined();
 });
 it.each(["javascript:alert(1)","http://example.com","https://user:pass@example.com","https://source.invalid"])("blocks unsafe source link %s",url=>expect(externalUrl(url)).toBeUndefined());
 it("keeps original official links",()=>expect(externalUrl("https://www.sec.gov/Archives/a.htm")).toBe("https://www.sec.gov/Archives/a.htm"));
 it("explains denied access",()=>expect(errorMessage(new APIError(403,"administrator_required"))).toContain("권한"));
});
