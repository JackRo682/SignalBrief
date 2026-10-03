import { test,expect } from "@playwright/test";
test("demo login, important changes, evidence, and settings",async({page})=>{
 await page.goto("/login");
 await page.getByRole("button",{name:"데모로 시작하기"}).click();
 await page.waitForURL(/\/(onboarding|today)/);
 if(page.url().includes("/onboarding")){
   await page.getByRole("button",{name:"관심종목 선택"}).click();
   for(const name of ["한빛 데이터", "Signal Devices", "Orbit Industrial"]){
      await page.getByRole("checkbox",{name:new RegExp(name)}).check();
   }
   await page.getByRole("button",{name:"설정 확인"}).click();
   await page.getByRole("button",{name:"설정 완료 · 브리핑 시작"}).click();
 }
 await expect(page).toHaveURL(/\/today/);
 await expect(page.locator('main a[href^="/events/"]').first()).toBeVisible();
 const brief=page.locator('a[href^="/events/"]').first();
 await expect(brief).toBeVisible();await brief.click();
 await expect(page.getByRole("heading",{name:"무슨 일이 있었나요?"})).toBeVisible();
 await expect(page.locator("#evidence h2")).toBeVisible();
 for(const label of ["이전 근거","현재 근거"]){
   const link=page.getByRole("link",{name:new RegExp(label)}).first();
   const href=await link.getAttribute("href");expect(href).toMatch(/^#evidence-/);
   await link.click();await expect(page.locator(href!).locator("blockquote")).toBeVisible();
   await expect(page.locator(href!).locator("blockquote")).not.toBeEmpty();
 }
 await page.getByRole("textbox",{name:"공시에 관한 질문"}).fill("설비투자 계획의 근거를 보여줘");
 await page.getByRole("button",{name:"근거 기반 질문하기"}).click();
 await expect(page.locator(".answer")).toBeVisible();
 await expect(page.locator(".answer p").first()).not.toBeEmpty();
 await page.goto("/watchlist");
 await expect(page.locator("main").getByRole("link",{name:"Signal Devices"})).toBeVisible();
 await page.goto("/today",{waitUntil:"domcontentloaded"});await page.goto("/watchlist");await page.goto("/today");
 await expect(page.locator('main a[href^="/events/"]').first()).toBeVisible();
 await page.goto("/alerts");const rule=`Browser-${Date.now()}`;
 await page.getByRole("textbox",{name:"규칙 이름"}).fill(rule);
 await page.getByRole("button",{name:"규칙 만들기"}).click();
 await expect(page.getByText(rule,{exact:true})).toBeVisible();
 await page.getByRole("button",{name:`${rule} 삭제`}).click();
 await expect(page.getByText(rule,{exact:true})).toHaveCount(0);
 await page.goto("/ops");await expect(page.getByText(/운영자만 접근/)).toBeVisible();
 await page.goto("/settings");await expect(page.getByRole("heading").first()).toBeVisible();
 await page.getByRole("button",{name:"로그아웃"}).click();await expect(page).toHaveURL(/\/login/);
 await page.goto("/today");await expect(page).toHaveURL(/\/login/);
});
test("a signed-out visitor cannot see operations",async({page})=>{
 await page.goto("/ops");await expect(page).toHaveURL(/\/login/);
});
