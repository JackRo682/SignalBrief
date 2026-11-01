import {expect, test} from '@playwright/test';
import {eventId, eventTitle, mobileFixture} from './mobile-fixture';

// Isolated browser fixtures: no real sign-in, customer events or external analytics.
for (const consent of [false, true]) {
  test(`event detail engagement respects analytics consent=${consent}`, async ({page}) => {
    await page.setViewportSize({width:390,height:844});
    const events: unknown[]=[];
    page.on('request', req => {
      if (new URL(req.url()).pathname.endsWith('/v1/analytics') && req.method()==='POST') {
        events.push(req.postDataJSON());
      }
    });
    const fixture=await mobileFixture(page,{analyticsConsent:consent});
    await page.goto(`/events/${eventId}`);
    await expect(page.getByRole('heading',{level:1,name:eventTitle})).toBeVisible();
    const evidence=page.locator('.rd-event-evidence').first();
    await expect(evidence).not.toHaveAttribute('open');
    await evidence.locator('summary').click();
    await expect(evidence).toHaveAttribute('open');
    await expect(evidence.locator('blockquote')).toBeVisible();
    // Closing and opening the same evidence must not create duplicate engagement.
    await evidence.locator('summary').click();
    await expect(evidence).not.toHaveAttribute('open');
    await evidence.locator('summary').click();
    await expect(evidence.locator('blockquote')).toBeVisible();
    if (consent) {
      await expect.poll(()=>events).toEqual([
        {event_name:'brief_opened',properties:{event_id:eventId,screen:'event_detail'}},
        {event_name:'evidence_opened',properties:{event_id:eventId,screen:'event_detail'}},
      ]);
      await expect.poll(()=>fixture.state.researchCalls.some(c=>c.p.kind==='view'&&c.p.screen==='event')).toBe(true);
      expect(JSON.stringify(fixture.state.researchCalls)).not.toContain(eventId);
      for(const call of fixture.state.researchCalls) {
        expect(Object.keys(call.p).sort()).toEqual(['active_ms','device','id','kind','page_id','screen','session_id']);
      }
    } else {
      expect(events).toEqual([]);
      expect(fixture.state.researchCalls).toEqual([]);
    }
    expect(fixture.state.unexpected).toEqual([]);
    expect(fixture.state.runtimeErrors).toEqual([]);
  });
}
