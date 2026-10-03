import { test, expect } from "./fixtures";
import { createHmac, randomUUID } from "node:crypto";
const api = "http://127.0.0.1:8000";
test("local admin separation and cross-user positions remain private", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "개발용 운영자 데모" }).click();
  await page.waitForURL(/\/(today|onboarding)/);
  if(page.url().includes("/onboarding")){
    await page.getByRole("button",{name:"관심종목 선택"}).click();
    for(const name of ["HBD","Signal Devices","Orbit Industrial"]){
      await page.getByRole("checkbox",{name:new RegExp(name)}).check();
    }
    await page.getByRole("button",{name:"설정 확인"}).click();
    await page.getByRole("button",{name:"설정 완료 · 브리핑 시작"}).click();
    await page.waitForURL(/\/today/);
  }
  await page.goto("/ops");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".ops-metrics")).toBeVisible();
  const adminToken = await page.evaluate(() => sessionStorage.getItem("signalbrief.demo.token"));
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  expect((await (await request.get(`${api}/v1/me`, { headers: adminHeaders })).json()).is_admin).toBe(true);
  expect((await request.get(`${api}/v1/ops/dashboard`, { headers: adminHeaders })).ok()).toBe(true);
  const token = (await (await request.post(`${api}/v1/auth/demo`)).json()).access_token;
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.get(`${api}/v1/ops/dashboard`, { headers })).status()).toBe(403);
  const companies = await (await request.get(`${api}/v1/companies`, { headers })).json();
  const company = companies[0].id;
  expect((await request.put(`${api}/v1/portfolio/positions/${company}`, { headers, data: { quantity: "1", average_cost: null, currency: "KRW" } })).status()).toBe(204);
  const stamp = Math.floor(Date.now() / 1000);
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: randomUUID(), iss: "signalbrief-demo", aud: "signalbrief-demo", iat: stamp, exp: stamp + 600 })}`;
  const signature = createHmac("sha256", "LOCAL-ONLY-SYNTHETIC-DATA-DO-NOT-DEPLOY-CHANGE-ME").update(unsigned).digest("base64url");
  const otherHeaders = { Authorization: `Bearer ${unsigned}.${signature}` };
  const other = await request.get(`${api}/v1/portfolio`, { headers: otherHeaders });
  expect(other.ok()).toBe(true);
  expect((await other.json()).positions).toEqual([]);
  await request.delete(`${api}/v1/portfolio/positions/${company}`, { headers: otherHeaders });
  const own = await (await request.get(`${api}/v1/portfolio`, { headers })).json();
  expect(own.positions.some((item: { company: { id: string } }) => item.company.id === company)).toBe(true);
  await request.delete(`${api}/v1/portfolio/positions/${company}`, { headers });
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/login/);
});
