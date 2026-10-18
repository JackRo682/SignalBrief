import {test,expect} from '@playwright/test';

test('Korean search is explicit, keeps source links, clears old results and retries',async({page})=>{
  let calls=0;
  await page.route('**/api/news?*',async route=>{
    calls++;
    const query=new URL(route.request().url()).searchParams.get('q');
    if(query==='카카오') return route.fulfill({status:502,json:{error:{code:'news_provider_unavailable'}}});
    return route.fulfill({json:{provider:'NAVER',query,retrievedAt:'2026-10-18T04:00:00.000Z',items:[{title:'합성 뉴스 <img src=x onerror=alert(1)>',link:'https://n.news.naver.com/article/000/000',originalLink:'https://example.com/synthetic',publishedAt:'2026-10-18T03:00:00.000Z'}]}});
  });
  await page.goto('/news');
  await expect(page.getByRole('heading',{name:'한국어 뉴스 검색'})).toBeVisible();expect(calls).toBe(0);
  await page.getByRole('button',{name:'뉴스 검색',exact:true}).click();
  await expect(page.getByRole('link',{name:'합성 뉴스 <img src=x onerror=alert(1)>'})).toHaveAttribute('href','https://example.com/synthetic');
  await expect(page.locator('time')).toContainText('오후 12:00');
  expect(await page.locator('.sb-korean-news img').count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('combobox',{name:'검색 주제'}).selectOption('카카오');
  await expect(page.locator('.sb-korean-news time')).toHaveCount(0);
  await page.getByRole('button',{name:'뉴스 검색',exact:true}).click();
  await expect(page.locator('.sb-korean-news').getByRole('alert')).toContainText('연결하지 못했습니다');
  await page.getByRole('combobox',{name:'검색 주제'}).selectOption('삼성전자');
  await page.getByRole('button',{name:'뉴스 검색',exact:true}).click();
  await expect(page.locator('time')).toHaveCount(1);
});
