"""Synthetic Samsung month rollover, published ranges and stable Saved identities."""
import copy
import hashlib
import json
from datetime import date, timedelta

import pytest
from test_calendar_sec_filing import OTHER, OWNER, ROOT
from test_calendar_sec_filing import calendar_db as calendar_db
from test_calendar_sec_filing import filing_db as filing_db
from test_calendar_sec_filing import onboard_db as onboard_db
from test_calendar_sec_filing import saved_filing_db as saved_filing_db
from test_calendar_sec_filing import sec_ir_db as sec_ir_db

pytestmark = pytest.mark.postgres
MIGRATION = ROOT / 'supabase/migrations/20261102051056_samsung_calendar_history.sql'
SAMSUNG = '10000000-0000-4000-8000-000000000074'
MSFT = '10000000-0000-4000-8000-000000000075'


@pytest.fixture
def samsung_db(saved_filing_db):
    connection, cur = saved_filing_db
    cur.execute("""insert into companies(id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        values(%s,'Synthetic reviewed Korean issuer','005930','KOSPI','dart','00126380',false,now()),
              (%s,'Synthetic reviewed US issuer','MSFT','NASDAQ','sec','0000789019',false,now())""", (SAMSUNG, MSFT))
    cur.execute(MIGRATION.read_text(), prepare=False)
    yield connection, cur


def entry(offset=-4, title='Synthetic official earnings call', span=None):
    day = date.today() + timedelta(days=offset)
    display = f'{day:%B} {day.day}, {day.year}'
    result = {'key': f'date:{day}:{title.lower()}', 'title': f'Samsung Electronics · {title}',
              'occurs_on': day.isoformat(), 'quote': f'{title} {display}', 'timezone': 'Asia/Seoul',
              'location': f'Past Events/{day.year}/dl.ir-event-list__detail[0]',
              'source_title': title, 'source_date': display}
    if span:
        end = day + timedelta(days=span)
        display = f'{day:%B} {day.day}, {day.year} ~ {end:%B} {end.day}, {end.year}'
        result.update(source_date=display, ends_on=end.isoformat(), quote=f'{title} {display}',
                      title=f'Samsung Electronics · {title} · 기간 시작 ({display})')
    return result


def ingest(cur, items, *, source='samsung-ir', missing=False, text=None):
    normalized = text or ' '.join(x['quote'] for x in items) or 'Upcoming Events Past Events'
    digest = hashlib.sha256(json.dumps([items, normalized], ensure_ascii=False).encode()).hexdigest()
    path = f'calendar/{source}/{digest}.html'
    if not missing:
        cur.execute("insert into storage.objects(bucket_id,name) values('signalbrief-raw',%s)", (path,))
    return cur.execute('select sb_calendar_ingest(%s,%s,%s,%s,%s::jsonb)',
                       (source, digest, path, normalized, json.dumps(items, ensure_ascii=False))).fetchone()[0]


def test_confirmed_past_and_explicit_range_are_visible_with_bounded_coverage(samsung_db):
    _, cur = samsung_db
    items = [entry(), entry(-12, 'Synthetic recurring conference', span=2)]
    assert ingest(cur, items) == 2
    rows = cur.execute("select id,title,occurs_on::text from calendar_items where source_key='samsung-ir' order by occurs_on").fetchall()
    assert len(rows) == 2 and rows[0][2] == items[1]['occurs_on']
    assert '기간 시작 (' in rows[0][1] and items[1]['source_date'] in rows[0][1]
    for row in rows:
        assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (row[0],)).fetchone()[0]
    coverage = cur.execute("select provenance from app_private.calendar_snapshots where source_key='samsung-ir'").fetchone()[0]
    assert coverage['complete'] is False
    assert coverage['coverage'] == 'current-month-upcoming-and-recent-history'
    cur.execute('SET LOCAL ROLE authenticated')
    assert cur.execute("select count(*) from calendar_items where source_key='samsung-ir'").fetchone()[0] == 2
    cur.execute('RESET ROLE')


def test_date_key_upgrade_preserves_legacy_calendar_id_and_owner_saved_reference(samsung_db):
    _, cur = samsung_db
    current = entry()
    legacy = {k: v for k, v in current.items() if k not in ('source_title', 'source_date')}
    legacy['key'] = current['source_title'].lower()
    assert ingest(cur, [legacy]) == 1
    identifier = cur.execute("select id from calendar_items where source_key='samsung-ir'").fetchone()[0]
    cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (OWNER,))
    cur.execute('SET LOCAL ROLE authenticated')
    cur.execute("select sb_user_action('watch_add',jsonb_build_object('company_id',%s::text))", (SAMSUNG,))
    assert cur.execute("select sb_reference_reminders(jsonb_build_object('action','set','calendar_id',%s::text,'enabled',true))", (identifier,)).fetchone()[0]['saved']
    cur.execute('RESET ROLE')
    assert ingest(cur, [current]) == 1
    assert ingest(cur, [current]) == 1
    # A worker started before the Edge deployment must reuse the upgraded row too.
    assert ingest(cur, [legacy]) == 1
    assert cur.execute("select id,source_event_key from calendar_items where source_key='samsung-ir'").fetchone() == (identifier, current['key'])
    cur.execute('SET LOCAL ROLE authenticated')
    saved = cur.execute("select sb_reference_reminders('{\"action\":\"list\"}')").fetchone()[0]
    assert len(saved) == 1 and saved[0]['calendar_id'] == identifier
    cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (OTHER,))
    assert cur.execute("select sb_reference_reminders('{\"action\":\"list\"}')").fetchone()[0] == []
    cur.execute('RESET ROLE')


def test_repeated_titles_on_different_published_dates_do_not_overwrite_each_other(samsung_db):
    _, cur = samsung_db
    first, second = entry(-8), entry(-2)
    assert ingest(cur, [first, second]) == 2
    rows = cur.execute("select id,occurs_on::text from calendar_items where source_key='samsung-ir' order by occurs_on").fetchall()
    assert len({row[0] for row in rows}) == 2
    assert [row[1] for row in rows] == [first['occurs_on'], second['occurs_on']]
    assert ingest(cur, [second, first]) == 2
    assert cur.execute("select id,occurs_on::text from calendar_items where source_key='samsung-ir' order by occurs_on").fetchall() == rows


def test_month_scoped_samsung_absence_cannot_withdraw_verified_future_date(samsung_db):
    _, cur = samsung_db
    assert ingest(cur, [entry(20)]) == 1
    identifier = cur.execute("select id from calendar_items where source_key='samsung-ir'").fetchone()[0]
    assert ingest(cur, [entry(-4)]) == 1
    assert ingest(cur, []) == 0
    assert cur.execute('select calendar_status from calendar_items where id=%s', (identifier,)).fetchone()[0] == 'confirmed'
    assert cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]


def test_microsoft_complete_schedule_withdrawal_is_unchanged(samsung_db):
    _, cur = samsung_db
    event = {'key': 'synthetic-id', 'title': 'Synthetic full schedule', 'occurs_on': (date.today() + timedelta(days=5)).isoformat(),
             'quote': 'Synthetic full schedule exact source quote', 'timezone': 'America/Los_Angeles', 'location': 'eventsData.Events[0]'}
    assert ingest(cur, [event], source='microsoft-ir') == 1
    assert ingest(cur, [], source='microsoft-ir') == 0
    assert cur.execute("select calendar_status from calendar_items where source_key='microsoft-ir'").fetchone()[0] == 'withdrawn'


@pytest.mark.parametrize('patch', [
    {'source_date': 'October 29'}, {'source_date': 'December 30 ~ January 2, 2026'},
    {'source_date': 'February 28 ~ 30, 2026'}, {'source_date': 'TBD'},
    {'ends_on': (date.today() + timedelta(days=1)).isoformat()},
    {'key': 'date:2026-01-01:wrong identity'}, {'source_title': 'A different source title'},
    {'title': 'Samsung Electronics · guessed single date'}, {'timezone': 'America/New_York'},
    {'location': 'Past Events/2009/dl.ir-event-list__detail[0]'}, {'source_title': 10},
])
def test_invalid_range_identity_or_original_evidence_is_rejected_atomically(samsung_db, patch):
    import psycopg
    connection, cur = samsung_db
    original = entry()
    assert ingest(cur, [original]) == 1
    before = cur.execute("select id,occurs_on,quote from calendar_items where source_key='samsung-ir'").fetchone()
    changed = {**copy.deepcopy(original), **patch}
    with pytest.raises(psycopg.Error), connection.transaction():
        ingest(cur, [changed])
    assert cur.execute("select id,occurs_on,quote from calendar_items where source_key='samsung-ir'").fetchone() == before


def test_missing_original_and_duplicate_legacy_identity_cannot_create_or_merge_rows(samsung_db):
    import psycopg
    connection, cur = samsung_db
    current = entry()
    with pytest.raises(psycopg.Error, match='calendar_original_missing'), connection.transaction():
        ingest(cur, [current], missing=True)
    legacy = {k: v for k, v in current.items() if k not in ('source_title', 'source_date')}
    legacy['key'] = current['source_title'].lower()
    ingest(cur, [current])
    cur.execute("""insert into calendar_items(id,company_id,title,occurs_on,origin,quote,created_at,
        source_snapshot_id,source_key,source_event_key,source_url,source_timezone,source_location,verified_at,calendar_status)
        select gen_random_uuid()::text,company_id,title,occurs_on,origin,quote,created_at,
         source_snapshot_id,source_key,%s,source_url,source_timezone,source_location,verified_at,calendar_status
        from calendar_items where source_key='samsung-ir'""", (legacy['key'],))
    with pytest.raises(psycopg.Error, match='samsung_calendar_identity_conflict'), connection.transaction():
        ingest(cur, [current])
    assert cur.execute("select count(*) from calendar_items where source_key='samsung-ir'").fetchone()[0] == 2


def test_ingestion_and_date_helper_keep_service_and_private_role_boundaries(samsung_db):
    _, cur = samsung_db
    for role in ('anon', 'authenticated'):
        assert not cur.execute("select has_function_privilege(%s,'public.sb_calendar_ingest(text,text,text,text,jsonb)','execute')", (role,)).fetchone()[0]
    assert cur.execute("select has_function_privilege('service_role','public.sb_calendar_ingest(text,text,text,text,jsonb)','execute')").fetchone()[0]
    for role in ('anon', 'authenticated', 'service_role'):
        assert not cur.execute("select has_function_privilege(%s,'app_private.calendar_samsung_dates(text)','execute')", (role,)).fetchone()[0]
    assert ingest(cur, [entry()]) == 1
    identifier = cur.execute("select id from calendar_items where source_key='samsung-ir'").fetchone()[0]
    cur.execute("update companies set provider_company_id='00999999' where id=%s", (SAMSUNG,))
    assert not cur.execute('select app_private.sb_calendar_confirmed(%s)', (identifier,)).fetchone()[0]
