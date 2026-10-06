import {expect, test, type Page, type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {companies, companyId, documents, eventId, eventTitle, events, mobileFixture, type MobileFixture} from './mobile-fixture';

// Runs against the local CI web process with intercepted, isolated synthetic data.
// No production credentials, financial data, external AI calls or account mutations are used.
const main = (page: Page) => page.locator('main#mobile-main');

async function healthy(page: Page, fixture: MobileFixture) {
  await expect(page.locator('.m-loading,.ws-loading,.ws-skeleton')).toHaveCount(0);
  await expect(page.locator('.sb-mobile [role="alert"]')).toHaveCount(0);
  expect(fixture.state.unexpected, 'Every data request must be served by the isolated fixture').toEqual([]);
  expect(fixture.state.runtimeErrors, 'No React, hydration or uncaught browser errors').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'The mobile page must not overflow horizontally').toBe(true);
}

async function screenshot(page: Page, info: TestInfo, fixture: MobileFixture, name: string) {
  await healthy(page, fixture);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const visibleImages = [...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top < innerHeight && rect.bottom > 0 && getComputedStyle(image).visibility !== 'hidden';
    });
    await Promise.all(visibleImages.map(async image => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([image.decode(), new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error(`Visible image did not load: ${image.getAttribute('src')}`)), 10000);})]);
        if (!image.naturalWidth) throw new Error(`Visible image is broken: ${image.getAttribute('src')}`);
      } finally {if (timer !== undefined) clearTimeout(timer);}
    }));
  });
  const layout = await page.evaluate(() => {
    const selectors = ['.m-brand-header', '.m-detail-header', '.m-main', '.m-section-title', '.m-search-heading', '.m-search-input-row', '.m-search-history-grid', '.m-search-suggestion-grid', '.m-search-company-tile', '.m-search-inline-filters', '.m-search-result-company', '.m-search-result-resource', '.m-company-hero', '.m-company-metric', '.m-company-event', '.m-company-timeline', '.m-company-monitor', '.m-company-document', '.m-portfolio-heading', '.m-portfolio-metrics', '.m-portfolio-basis', '.m-portfolio-allocation', '.m-portfolio-holding', '.m-portfolio-holding-main', '.m-portfolio-holding>footer'];
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].map((element, index) => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return {selector, index, x: rect.x, y: rect.y, width: rect.width, height: rect.height, padding: style.padding, margin: style.margin, minHeight: style.minHeight, fontSize: style.fontSize, lineHeight: style.lineHeight};
    }));
  });
  await writeFile(info.outputPath(`${name}-layout.json`), JSON.stringify(layout, null, 2));
  await page.screenshot({path: info.outputPath(`${name}.png`), animations: 'disabled', scale: 'css'});
}

for (const viewport of [{width: 470, height: 836}, {width: 390, height: 844}]) {
  test.describe(`authenticated mobile ${viewport.width}x${viewport.height}`, () => {
    test.use({viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light'});
    test.beforeEach(({}, info) => test.skip(info.project.name !== 'mobile', 'Dedicated mobile references; desktop has its preserved workspace suite.'));

    test('all ten reference screens render with real DOM controls and no overflow', async ({page}, info) => {
      const fixture = await mobileFixture(page, {onboarding: true});
      await page.goto('/onboarding');
      await expect(page.getByLabel('온보딩 단계 1 / 3')).toBeVisible();
      await expect(page.locator('.m-onboard-companies > button')).toHaveCount(6);
      await expect(page.getByRole('button', {name: '나중에 설정', exact: true})).toBeEnabled();
      await screenshot(page, info, fixture, '02-onboarding');
      await page.getByRole('button', {name: '나중에 설정', exact: true}).click();
      await expect(page).toHaveURL(/\/today$/);
      const screens = [
        {path: '/today', name: '01-today', title: /오늘의 변화/, ready: '.m-event-card', count: 4},
        {path: '/explore', name: '03-explore', title: '검색 / 탐색', ready: '.m-search-company-tile', count: 4},
        {path: '/search?q=엔비디아', name: '04-search-results', title: '검색 결과', ready: '.m-search-result-company', count: 1},
        {path: `/companies/${companyId}`, name: '05-company', title: '엔비디아', ready: '.m-company-metric', count: 4},
        {path: `/events/${eventId}`, name: '06-event', title: eventTitle, ready: '.m-event h1', count: 1},
        {path: '/watchlist', name: '07-watchlist', title: '관심종목', ready: '.m-watch-card', count: 4},
        {path: '/portfolio', name: '08-portfolio', title: '포트폴리오', ready: '.m-portfolio-holding', count: 4},
        {path: '/saved', name: '09-saved', title: '저장 / 기록', ready: '.m-saved-card', count: 3},
        {path: '/settings', name: '10-settings', title: '설정', ready: '.m-settings-provider', count: 1},
      ];
      for (const screen of screens) {
        await test.step(screen.name, async () => {
          await page.goto(screen.path);
          await expect(main(page)).toBeVisible();
          await expect(main(page).getByRole('heading', {level: 1})).toHaveText(screen.title);
          await expect(page.locator(screen.ready)).toHaveCount(screen.count);
          if (screen.name === '05-company') await expect(page.locator('.m-detail-header>strong')).toHaveText('기업 개요');
          if (screen.name === '06-event') await expect(page.locator('.m-detail-header>strong')).toHaveText('이벤트 상세');
          if (screen.name === '08-portfolio') await expect(page.locator('.m-portfolio-donut svg')).toBeVisible();
          if (screen.name === '10-settings') await expect(page.locator('.m-settings-profile')).toContainText('mobile-fixture@example.invalid');
          await screenshot(page, info, fixture, screen.name);
        });
      }
      expect(fixture.state.calls.filter(call => call.action === 'onboarding_complete').map(call => call.p)).toEqual([{company_ids: [], removed_company_ids: [], positions: []}]);
      expect(fixture.state.watched.size).toBe(4);
      expect(fixture.state.positions.size).toBe(4);
    });

    test('onboarding applies only explicit deltas and preserves concurrent account edits', async ({page}) => {
      const fixture = await mobileFixture(page, {onboarding: true, watchIds: [companies[0].id, companies[1].id], holdingIds: [companies[0].id]});
      await page.goto('/today');
      await expect(page).toHaveURL(/\/onboarding$/);
      const companyChoices = page.locator('.m-onboard-companies');
      await expect(companyChoices.getByRole('button', {name: /애플/})).toHaveAttribute('aria-pressed', 'true');
      await companyChoices.getByRole('button', {name: /애플/}).click();
      await companyChoices.getByRole('button', {name: /마이크로소프트/}).click();
      await page.getByRole('button', {name: '다음', exact: true}).click();
      await expect(page.getByLabel('온보딩 단계 2 / 3')).toBeVisible();
      await expect(page.getByLabel('엔비디아 보유 수량', {exact: true})).toHaveValue('32');
      await expect(page.getByLabel('엔비디아 평균 매수가', {exact: true})).toHaveValue('120');
      await page.getByLabel('마이크로소프트 보유 수량', {exact: true}).fill('0.00000001');
      await page.getByLabel('마이크로소프트 평균 매수가', {exact: true}).fill('400.12345678');
      await page.getByLabel('마이크로소프트 통화', {exact: true}).selectOption('USD');
      await page.getByRole('button', {name: '다음', exact: true}).click();
      await expect(page.getByLabel('온보딩 단계 3 / 3')).toBeVisible();
      // Simulate another tab adding an unrelated watch/holding after this form loaded.
      fixture.state.watched.add(companies[2].id);
      fixture.upsertPosition(companies[1].id, {quantity: '7.5', average_cost: '200', currency: 'USD'});
      await page.getByRole('button', {name: '오늘의 변화 시작하기', exact: true}).click();
      await expect(page).toHaveURL(/\/today$/);
      await expect(main(page).getByRole('heading', {level: 1})).toContainText('오늘의 변화');
      expect(fixture.state.calls.filter(call => call.action === 'onboarding_complete').map(call => call.p)).toEqual([{
        company_ids: [companies[3].id], removed_company_ids: [companies[1].id],
        positions: [{company_id: companies[3].id, quantity: '0.00000001', average_cost: '400.12345678', currency: 'USD'}], analytics_consent: false,
      }]);
      expect([...fixture.state.watched].sort()).toEqual([companies[0].id, companies[2].id, companies[3].id].sort());
      expect(fixture.state.positions.get(companies[0].id)).toMatchObject({quantity: '32', average_cost: '120'});
      expect(fixture.state.positions.get(companies[1].id)).toMatchObject({quantity: '7.5', average_cost: '200'});
      expect(fixture.state.positions.get(companies[3].id)).toMatchObject({quantity: '0.00000001', average_cost: '400.12345678'});
      await page.reload();
      await expect(page).toHaveURL(/\/today$/);
      await expect(main(page)).toBeVisible();
      await healthy(page, fixture);
    });

    test('an empty account can skip onboarding without holdings or consent changes', async ({page}) => {
      const fixture = await mobileFixture(page, {onboarding: true, empty: true, analyticsConsent: true});
      await page.goto('/onboarding');
      await page.getByRole('button', {name: '나중에 설정', exact: true}).click();
      await expect(page).toHaveURL(/\/today$/);
      await expect(main(page).getByRole('heading', {level: 1})).toContainText('오늘의 변화');
      expect(fixture.state.calls.filter(call => call.action === 'onboarding_complete').map(call => call.p)).toEqual([{company_ids: [], removed_company_ids: [], positions: []}]);
      expect(fixture.state.profile).toMatchObject({onboarding_completed: true, analytics_consent: true});
      expect(fixture.state.watched.size).toBe(0);
      expect(fixture.state.positions.size).toBe(0);
      await page.reload();
      await expect(main(page).getByRole('heading', {level: 1})).toContainText('오늘의 변화');
      await healthy(page, fixture);
    });

    test('watch, holdings, evidence, saves, AI and linked research flows persist', async ({page}, info) => {
      const fixture = await mobileFixture(page);
      await page.goto('/watchlist');
      await expect(page.locator('.m-watch-card')).toHaveCount(4);
      await page.getByRole('button', {name: '테슬라 관심종목 삭제', exact: true}).click();
      await expect(page.locator('.m-watch-card')).toHaveCount(3);
      expect(fixture.state.watched.has(companies[2].id)).toBe(false);
      await page.getByRole('button', {name: '종목 추가', exact: true}).click();
      const add = page.getByRole('dialog', {name: '관심종목 추가', exact: true});
      await add.getByLabel('기업명 또는 종목코드', {exact: true}).fill('AVGO');
      await expect(add.locator('.m-watch-results > div')).toHaveCount(1);
      await add.getByRole('button', {name: '+ 추가', exact: true}).click();
      await expect(add.getByRole('button', {name: '추가됨', exact: true})).toBeDisabled();
      await add.getByRole('button', {name: '닫기', exact: true}).click();
      await expect(page.locator('.m-watch-card')).toHaveCount(4);
      await page.getByRole('button', {name: '엔비디아 알림', exact: true}).click();
      await expect(page.getByRole('button', {name: '엔비디아 알림', exact: true})).toHaveAttribute('aria-pressed', 'false');
      expect(fixture.state.preferences.muted_companies).toContain(companyId);
      await page.getByRole('link', {name: '엔비디아 상세 보기', exact: true}).click();
      await expect(page).toHaveURL(new RegExp(`/companies/${companyId}$`));
      await page.getByRole('button', {name: '보유 정보 수정', exact: true}).click();
      const holding = page.getByRole('dialog', {name: '보유 정보 입력', exact: true});
      await expect(holding.getByLabel('보유 수량', {exact: true})).toHaveValue('32');
      await holding.getByLabel('보유 수량', {exact: true}).fill('32.00000001');
      await holding.getByLabel('평균 단가 (선택)', {exact: true}).fill('120.12345678');
      await holding.getByRole('button', {name: '저장', exact: true}).click();
      await expect(holding).toHaveCount(0);
      expect(fixture.state.positions.get(companyId)).toMatchObject({quantity: '32.00000001', average_cost: '120.12345678', currency: 'USD'});
      await page.locator('.m-company-event').filter({hasText: eventTitle}).click();
      await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
      await page.getByRole('button', {name: '이벤트 저장', exact: true}).click();
      await expect(page.getByRole('button', {name: '이벤트 저장 취소', exact: true})).toBeVisible();
      expect(fixture.state.saved.has(`event:${eventId}`)).toBe(true);
      await page.getByRole('button', {name: /원문 인용 보기/}).click();
      await expect(page.locator('#mobile-event-evidence blockquote')).toHaveCount(4);
      await expect(page.locator('#mobile-event-evidence')).toContainText('Synthetic fixture: Revenue');
      await page.getByRole('button', {name: 'AI 후속 질문하기', exact: true}).click();
      const ask = page.getByRole('dialog', {name: 'AI 후속 질문', exact: true});
      await ask.getByLabel('질문', {exact: true}).fill('매출 수치의 근거를 보여줘');
      await ask.getByRole('button', {name: '질문 보내기', exact: true}).click();
      await expect(ask.locator('.m-event-answer')).toContainText('USD 45,000 million');
      expect(fixture.state.questions).toHaveLength(1);
      expect(fixture.state.questions[0].event_id).toBe(eventId);
      await ask.getByRole('link', {name: '전체 대화와 기록 열기', exact: true}).click();
      await expect(page).toHaveURL(new RegExp(`/questions\\?event=${eventId}`));
      await expect(page.locator('.m-question-context h2')).toHaveText(eventTitle);
      await expect(page.getByRole('combobox', {name: '질문할 이벤트', exact: true})).toHaveValue(eventId);
      await expect(page.locator('.m-question-history-item')).toHaveCount(1);
      await healthy(page, fixture);

      await page.goto(`/saved?kind=event&company=${companyId}`);
      await expect(page.getByLabel('저장 항목 기업', {exact: true})).toHaveValue(companyId);
      await expect(page.locator('.m-saved-card')).toHaveCount(1);
      await expect(page.locator('.m-saved-title')).toHaveText(eventTitle);
      await page.getByRole('button', {name: `${eventTitle} 저장 취소`, exact: true}).click();
      await expect(page.locator('.m-saved-card')).toHaveCount(0);
      expect(fixture.state.saved.has(`event:${eventId}`)).toBe(false);

      await page.goto('/explore');
      const visitCount = fixture.state.visits.size;
      await page.getByRole('button', {name: '테슬라 검색 기록 삭제', exact: true}).click();
      await expect(page.getByRole('button', {name: '테슬라 검색 기록 삭제', exact: true})).toHaveCount(0);
      expect(fixture.state.visits.size).toBe(visitCount);
      await page.getByLabel('기업명 또는 키워드 검색', {exact: true}).fill('NVDA');
      await page.locator('.m-search-input').getByRole('button', {name: '검색', exact: true}).click();
      await expect(page).toHaveURL(/q=NVDA/);
      await expect(page.locator('.m-search-result-resource').filter({hasText: documents[0].title}).first()).toHaveAttribute('href', `/documents/${documents[0].id}?kind=document`);

      await page.goto(`/companies/${companyId}/timeline`);
      await expect(main(page).getByRole('heading', {level: 1})).toHaveText('기업 타임라인');
      await expect(page.locator('.m-timeline-item')).toHaveCount(3);
      await expect(page.locator('.m-timeline-item').first().getByRole('link').first()).toHaveAttribute('href', `/events/${eventId}`);
      await screenshot(page, info, fixture, '11-timeline');
      await page.goto('/calendar');
      await expect(page.locator('.m-calendar-grid')).toBeVisible();
      await expect(page.locator('.m-calendar-item')).toHaveCount(3);
      await expect(page.locator('.m-calendar-item-title').first()).toHaveAttribute('href', `/events/${eventId}`);
      await screenshot(page, info, fixture, '12-calendar');
      await page.goto('/alerts');
      await expect(page.locator('.m-alert-card')).toHaveCount(4);
      await page.locator('.m-alert-title').filter({hasText: events[0].headline}).click();
      await expect(page).toHaveURL(new RegExp(`/events/${eventId}$`));
      await expect.poll(() => fixture.state.notifications[0].read_at).not.toBeNull();

      if (viewport.width === 390) {
        fixture.state.preferences.font_scale = 3;
        fixture.state.preferenceVersion++;
        for (const path of ['/settings', '/portfolio']) {
          await page.goto(path);
          await expect(main(page)).toBeVisible();
          await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--sb-font-scale'))).toBe('1.16');
          await healthy(page, fixture);
        }
      }
      await healthy(page, fixture);
    });
  });
}
