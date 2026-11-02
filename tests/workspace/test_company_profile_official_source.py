"""The reviewed official-source success path reaches the actual production SQL wrapper."""
from pathlib import Path

import pytest
from sqlalchemy import text
from test_company_profile_enrichment import admin, claim_and_archive, snapshot
from test_company_profile_enrichment import db as db
from test_company_profile_enrichment import enriched as enriched
from test_company_profile_enrichment import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]
DART_MIGRATION = '20261102020454_dart_profile_periodic_sources.sql'
MIGRATION = '20261102023317_profile_official_source_binding.sql'
OFFICIAL_URL = 'https://investors.synthetic.example/leadership/'


def apply(conn, name):
    with conn.connection.driver_connection.cursor() as cursor:
        cursor.execute((ROOT / 'supabase/migrations' / name).read_text(), prepare=False)


@pytest.fixture
def delegated(enriched):
    apply(enriched, DART_MIGRATION)
    return enriched


@pytest.fixture
def official(delegated):
    apply(delegated, MIGRATION)
    return delegated


def reviewed_snapshot(conn):
    value = snapshot(conn)
    source = value['archives'][0].copy()
    quote = 'Alex Synthetic Chief Executive Officer.'
    source.update(id='b' * 64, source_sha256='b' * 64, provider='Official company',
                  source_url=OFFICIAL_URL, object_key=f"profiles/official/{'b' * 64}.html",
                  published_on=None, publication_precision='unknown', report_period=None,
                  form_type=None, title='Official leadership', normalized_text=quote)
    value['archives'].append(source)
    value['result']['sources'].append({key: item for key, item in source.items()
                                      if key not in ('object_key', 'provider_company_id', 'ticker', 'normalized_text')})
    value['result']['leadership'] = [{
        'name': 'Alex Synthetic', 'role': 'Chief Executive Officer',
        'basis': 'official_page', 'as_of': source['fetched_at'][:10],
        'evidence': {'source_id': source['id'], 'quote': quote, 'location': {
            'kind': 'normalized_text', 'start': 0, 'end': len(quote), 'section': 'Official leadership',
        }},
    }]
    conn.execute(text("""insert into app_private.company_profile_official_sources
        (provider,provider_company_id,kind,source_url,issuer_label)
        values('sec','0000000001','leadership_q4',:url,'Synthetic Corporation')"""), {'url': OFFICIAL_URL})
    claim_and_archive(conn, value)
    return value


def denial(conn, value, state, code=None):
    point = conn.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(conn, 'save', value)
    point.rollback()
    assert caught.value.orig.sqlstate == state
    if code:
        assert caught.value.orig.diag.message_primary == code


def test_previous_official_source_branch_reproduces_the_live_ambiguous_column(delegated):
    value = reviewed_snapshot(delegated)
    denial(delegated, value, '42702')


def test_reviewed_official_leadership_and_sec_evidence_save_through_the_delegating_rpc(official):
    value = reviewed_snapshot(official)
    assert admin(official, 'save', value) == value['result']
    cached = admin(official, 'read')
    assert cached['result']['leadership'] == value['result']['leadership']
    assert cached['result']['business'] == value['result']['business']
    assert cached['refresh_in_progress'] is False
    assert all('normalized_text' not in source and 'object_key' not in source
               for source in cached['result']['sources'])


@pytest.mark.parametrize('mutation', ['unreviewed_url', 'other_issuer', 'other_provider',
                                     'archive_missing', 'forged_name', 'incorrect_as_of'])
def test_qualification_preserves_exact_identity_archive_and_evidence_denials(official, mutation):
    value = reviewed_snapshot(official)
    expected = 'unreviewed_profile_source'
    if mutation == 'unreviewed_url':
        value['archives'][1]['source_url'] += 'unreviewed/'
        value['result']['sources'][1]['source_url'] += 'unreviewed/'
    elif mutation == 'other_issuer':
        official.execute(text("update app_private.company_profile_official_sources set provider_company_id='0000000002' where source_url=:url"), {'url': OFFICIAL_URL})
    elif mutation == 'other_provider':
        official.execute(text("update app_private.company_profile_official_sources set provider='dart' where source_url=:url"), {'url': OFFICIAL_URL})
    elif mutation == 'archive_missing':
        official.execute(text("delete from storage.objects where bucket_id='signalbrief-raw' and name=:path"), {'path': value['archives'][1]['object_key']})
        expected = 'profile_source_not_archived'
    elif mutation == 'forged_name':
        value['result']['leadership'][0]['name'] = 'Invented Executive'
        expected = 'profile_quote_mismatch'
    else:
        value['result']['leadership'][0]['as_of'] = '2000-01-01'
        expected = 'invalid_profile_leadership'
    denial(official, value, 'PT422', expected)


@pytest.mark.parametrize('role', ['anon', 'authenticated'])
def test_official_profile_fix_does_not_grant_client_write_access(official, role):
    official.exec_driver_sql(f'SET LOCAL ROLE {role}')
    point = official.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(official, 'save', {})
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'
