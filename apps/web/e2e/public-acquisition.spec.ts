import {test,expect,type Page} from '@playwright/test';
async function anonymous(page:Page){
 await page.route('**/v1/config',r=>r.fulfill({json:{auth_mode:'supabase',demo_mode:false,demo_admin_enabled:false}}));
 await page.route('**/api/auth-config',r=>r.fulfill({json:{url:'https://test-project.supabase.co',publishableKey:'sb_publishable_isolated_fixture'}}));
 await page.route('**/api/public-stats',r=>r.fulfill({json:{}}));
 // Inspect the real command queue without sending synthetic visits to Google.
 await page.route('https://www.googletagmanager.com/**',r=>r.fulfill({contentType:'application/javascript',body:'/* isolated external transport */'}));
}
test('public indexing, consent, client navigation and refusal protect private content',async({page,request},testInfo)=>{
 await anonymous(page);
 const sitemap=await request.get('/sitemap.xml');expect(sitemap.status()).toBe(200);expect(await sitemap.text()).toContain('https://signalbrief.online/features');
 const robots=await request.get('/robots.txt');expect(robots.status()).toBe(200);expect(await robots.text()).toContain('Sitemap: https://signalbrief.online/sitemap.xml');
 await page.goto('/');await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','index, follow');await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://signalbrief.online/');
 const consent=page.getByRole('complementary',{name:'방문 통계 설정'});
 await expect(consent).toBeVisible();expect(await page.locator('#sb-google-analytics').count()).toBe(0);
 await consent.getByRole('button',{name:'동의',exact:true}).click();await expect(page.locator('#sb-google-analytics')).toHaveCount(1);
 await page.locator('.public-info-nav').getByRole('link',{name:'주요 기능',exact:true}).click();
 await expect(page).toHaveURL(/\/features$/);
 await expect.poll(()=>page.evaluate(()=>JSON.stringify((window as Window & {dataLayer?:unknown[]}).dataLayer))).toContain('SignalBrief · features');
 await consent.getByRole('button',{name:'방문 통계 설정',exact:true}).click();
 await consent.getByRole('button',{name:'거부',exact:true}).click();
 await page.goto('/login?next=%2Fcompanies%2FPRIVATE_RECORD');
 await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content','noindex, nofollow');
 expect(await page.locator('#sb-google-analytics').count()).toBe(0);
 await page.screenshot({path:testInfo.outputPath('public-consent-refused.png'),fullPage:true});
});
