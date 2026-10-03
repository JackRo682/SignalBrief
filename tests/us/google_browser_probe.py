"""Real, unauthenticated login initiation probe; never enter account credentials.
No network traces, browser storage, OAuth state, codes or tokens are persisted.
This checks initiation only, not consent, token exchange or signed-in pages.
"""
import asyncio
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from playwright.async_api import async_playwright

SITE = 'https://signalbrief-beta.vercel.app'
CALLBACK = 'https://xabzzhtdmqsaqdauthbu.supabase.co/auth/v1/callback'


async def run():
    result = {'google_request_seen': False, 'callback_matches': False,
              'consent_completed': False, 'signed_in_session_verified': False}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        def request_seen(request):
            u = urlsplit(request.url)
            if u.hostname == 'accounts.google.com':
                result['google_request_seen'] = True
                result['callback_matches'] |= parse_qs(u.query).get('redirect_uri') == [CALLBACK]
        page.on('request', request_seen)
        try:
            await page.goto(SITE + '/login', wait_until='networkidle', timeout=40000)
            await page.locator('#googleLogin').click(timeout=15000)
            await page.wait_for_timeout(6000)
            result['google_page_reached'] = urlsplit(page.url).hostname == 'accounts.google.com'
            text = await page.locator('body').inner_text(timeout=10000)
            result['recognized_errors'] = [code for code in [
                'redirect_uri_mismatch', 'invalid_client', 'deleted_client',
                'access_denied', 'disallowed_useragent', 'auth_public_configuration_missing'
            ] if code in text]
            result['email_field_visible'] = await page.locator('input[type=email]').count() > 0
            result['status'] = 'initiation_verified' if result['google_request_seen'] else 'initiation_not_verified'
        except Exception as error:
            # Exception text can include credential-bearing URLs. Persist type only.
            result['status'] = 'probe_blocked'
            result['exception_type'] = type(error).__name__
        finally:
            await browser.close()
    Path('us-results').mkdir(exist_ok=True)
    Path('us-results/google-initiation.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    asyncio.run(run())
