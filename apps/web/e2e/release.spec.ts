import { type Page, type TestInfo } from "@playwright/test";
import { test, expect } from "./fixtures";
import { readFile } from "node:fs/promises";
async function shot(page:Page, info:TestInfo, name:string){const path=info.outputPath(`${info.project.name}-${name}.png`);await page.screenshot({path,fullPage:true});await info.attach(name,{path,contentType:"image/png"});}
async function enter(page:Page,admin=false){
 await page.goto("/login");await page.getByRole("button",{name:admin?"개발용 운영자 데모":"데모로 시작하기"}).click();await page.waitForURL(/\/(today|onboarding)/);
 if(page.url().includes("/onboarding")){await page.getByRole("button",{name:"관심종목 선택"}).click();for(const name of ["HBD","Signal Devices","Orbit Industrial"])await page.getByRole("checkbox",{name:new RegExp(name)}).check();await page.getByRole("button",{name:"설정 확인"}).click();await page.getByRole("button",{name:"설정 완료 · 브리핑 시작"}).click();}
 await expect(page).toHaveURL(/\/today/);await expect(page.locator("main .event-card").first()).toBeVisible();
}
test("new portfolio, CSV, calendar, question and navigation flows",async({page},info)=>{
 test.setTimeout(240000);
 await page.goto("/");await expect(page.getByRole("heading",{level:1})).toContainText("무엇이 바뀌었는가");await shot(page,info,"landing");
 await enter(page);await shot(page,info,"today");
 const firstEvent=page.locator('main a[href^="/events/"]').first();await firstEvent.click();await expect(page.locator("#evidence h2")).toBeVisible();await shot(page,info,"event-evidence");
 await page.goto("/portfolio");const companySelect=page.getByRole("combobox",{name:"기업",exact:true});const companyId=await companySelect.locator("option").filter({hasText:"HBD"}).getAttribute("value");expect(companyId).toBeTruthy();await companySelect.selectOption(companyId!);await page.getByRole("textbox",{name:"보유 수량"}).fill("10.25");await page.getByRole("textbox",{name:"평균 취득가"}).fill("100.50");await page.getByRole("button",{name:"보유 정보 저장"}).click();await expect(page.getByText("취득원가 1,030.125 USD")).toBeVisible();
 const downloadPromise=page.waitForEvent("download");await page.getByRole("button",{name:"CSV 내보내기"}).click();const download=await downloadPromise;const path=await download.path();expect(path).toBeTruthy();expect(await readFile(path!,"utf8")).toContain('"10.25","100.5');
 await page.locator('input[type="file"]').setInputFiles({name:"holdings.csv",mimeType:"text/csv",buffer:Buffer.from("ticker,quantity,average_cost,currency\nHBD,20.5,200.25,USD\n")});await expect(page.getByText("20.5주",{exact:true})).toBeVisible();await shot(page,info,"portfolio");await page.getByRole("button",{name:/한빛 데이터.*보유 정보 삭제/}).click();await expect(page.getByText("20.5주",{exact:true})).toHaveCount(0);
 await page.goto("/watchlist");await expect(page.locator("main").getByRole("link",{name:"Signal Devices"})).toBeVisible();await shot(page,info,"watchlist");
 await page.goto("/timeline");const timelineSelect=page.getByRole("combobox",{name:"타임라인을 볼 기업"});const timelineId=await timelineSelect.locator("option").filter({hasText:"SGDV"}).getAttribute("value");expect(timelineId).toBeTruthy();await timelineSelect.selectOption(timelineId!);await expect(page.locator("main .event-card").first()).toBeVisible();await shot(page,info,"timeline");
 await page.goto("/questions");const select=page.getByRole("combobox",{name:"공시 선택"});await expect(select.locator("option")).not.toHaveCount(1);await select.selectOption({index:1});await page.getByRole("textbox",{name:"공시에 관한 질문"}).fill("이전 공시와 무엇이 달라졌나요?");await page.getByRole("button",{name:"질문 보내기"}).click();await expect(page.getByText("근거 검색 결과",{exact:true})).toBeVisible();await shot(page,info,"questions");
 await page.goto("/calendar");const title=`Verification ${Date.now()}`;await page.getByRole("textbox",{name:"제목",exact:true}).fill(title);await page.getByLabel("날짜",{exact:true}).fill("2030-01-15");await page.getByRole("button",{name:"일정 추가",exact:true}).click();await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:"2030년 1월"})).toBeVisible();await shot(page,info,"calendar");await page.getByRole("button",{name:`${title} 삭제`}).click();await expect(page.getByRole("heading",{name:title,exact:true})).toHaveCount(0);
 await page.goto("/alerts");await expect(page.getByRole("heading",{level:1,name:"알림 센터"})).toBeVisible();await shot(page,info,"alerts");
 await page.goto("/settings");await expect(page.getByRole("heading",{level:1})).toBeVisible();await shot(page,info,"settings");
 await page.getByRole("button",{name:"로그아웃"}).click();await expect(page).toHaveURL(/\/login/);
 await enter(page,true);await page.goto("/ops");await expect(page.locator(".ops-metrics")).toBeVisible();await shot(page,info,"ops");
});
