import {expect, test} from '@playwright/test';
import {eventId, eventTitle, mobileFixture} from './mobile-fixture';

// Isolated browser fixtures: no real sign-in, customer events or external analytics.
for (const consent of [false, true]) {
  test(`mobile detail engagement respects analytics consent=${consent}`, async ({page}) => {
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
    await page.getByRole('button',{name:/원문 인용 보기/}).click();
    await expect(page.getByRole('heading',{name:'원문 인용과 검증 근거'})).toBeVisible();
    if (consent) {
      await expect.poll(()=>events).toEqual([
        {event_name:'brief_opened',properties:{event_id:eventId,screen:'mobile_detail'}},
        {event_name:'evidence_opened',properties:{event_id:eventId,screen:'mobile_detail'}},
      ]);
    } else {
      expect(events).toEqual([]);
    }
    expect(fixture.state.unexpected).toEqual([]);
    expect(fixture.state.runtimeErrors).toEqual([]);
  });
}
