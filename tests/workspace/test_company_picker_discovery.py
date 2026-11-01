"""Synthetic official identities exercise the picker query's actual PG boundary."""
import json
from pathlib import Path

import pytest
from sqlalchemy import text
from test_discovery_reliability import admin
from test_discovery_reliability import discovery as discovery
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres
ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def filtered(discovery):
    discovery.exec_driver_sql('RESET ROLE')
    for name in ('20261101072153_company_official_overview.sql',
                 '20261101072155_company_picker_discovery_filters.sql'):
        with discovery.connection.driver_connection.cursor() as cursor:
            cursor.execute((ROOT / 'supabase/migrations' / name).read_text(), prepare=False)
    for provider, lease, digest in (('sec', '90000000-0000-4000-8000-000000000011', 'c'),
                                    ('dart', '90000000-0000-4000-8000-000000000012', 'd')):
        assert admin(discovery, 'claim', {'provider': provider, 'lease': lease}) is True
        items = [{'provider_company_id': str(i + 400000).zfill(10 if provider == 'sec' else 8),
                  'ticker': f'S{i:05}' if provider == 'sec' else str(i + 500000),
                  'name': f'Filler {i}' if provider == 'sec' else f'Picker A {i:03}',
                  'market': 'NASDAQ' if provider == 'sec' else 'KR'} for i in range(100)]
        if provider == 'sec':
            items[0].update(ticker='MU', name='Picker Z Micron', market='NASDAQ GLOBAL SELECT')
        else:
            items[-1].update(ticker='006260', name='LS', official_english_name='LS Corp')
        extension = 'json' if provider == 'sec' else 'zip'
        admin(discovery, 'save', {'provider': provider, 'lease': lease, 'sha': digest * 64,
                                'object_key': f'directory/{provider}/{digest * 64}.{extension}', 'items': items})
    discovery.exec_driver_sql('SET LOCAL ROLE authenticated')
    return discovery


def search(conn, q, **filters):
    return conn.execute(text('select public.sb_company_discovery_filtered(:q,cast(:p as jsonb))'),
                        {'q': q, 'p': json.dumps(filters)}).scalar()


def test_provider_and_market_scopes_precede_the_global_result_cap(filtered):
    original = filtered.exec_driver_sql("select public.sb_company_discovery('Picker')").scalar()
    assert len(original['items']) == 30
    assert not any(row['ticker'] == 'MU' for row in original['items'])
    for filters in ({'provider': 'sec'}, {'market_group': 'overseas'}, {'market': 'NASDAQ GLOBAL SELECT'}):
        result = search(filtered, 'Picker', **filters)
        assert result['total'] == 1
        assert [(row['provider'], row['ticker']) for row in result['items']] == [('sec', 'MU')]
        assert result['source_status'] == 'ready'
    # Search and filtering remain reads: no company activation/follow/event side effects.
    filtered.exec_driver_sql('RESET ROLE')
    assert filtered.exec_driver_sql("select count(*) from public.companies where provider_company_id='0000400000'").scalar() == 0


def test_hydrated_market_and_sec_provenance_remain_searchable(filtered):
    found = search(filtered, 'LS', provider='dart')
    assert found['items'][0]['ticker'] == '006260'
    filtered.exec_driver_sql('RESET ROLE')
    ls = admin(filtered, 'activate', {'provider': 'dart', 'provider_company_id': '00400099', 'ticker': '006260'})
    mu = admin(filtered, 'activate', {'provider': 'sec', 'provider_company_id': '0000400000', 'ticker': 'MU'})
    filtered.execute(text("update public.companies set market='KOSPI' where id=:id"), {'id': ls['id']})
    filtered.exec_driver_sql('SET LOCAL ROLE authenticated')
    scoped = search(filtered, 'LS', market_group='kospi')
    assert [(row['company_id'], row['market']) for row in scoped['items']] == [(ls['id'], 'KOSPI')]
    result = filtered.exec_driver_sql("select public.sb_redesign_workspace('design_directory','{\"q\":\"MU\",\"market_group\":\"overseas\"}')").scalar()
    assert [row['id'] for row in result['items']] == [mu['id']]


@pytest.mark.parametrize('filters', [{'provider': 'other'}, {'market_group': 'arbitrary'}, {'market': "x';drop"},
                                    {'market': 'x' * 33}, {'provider': 1}, {'market_group': None}, {'unexpected': 'value'}])
def test_invalid_filters_fail_closed(filtered, filters):
    point = filtered.begin_nested()
    with pytest.raises(Exception) as caught:
        search(filtered, 'LS', **filters)
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT422'


def test_filtered_search_keeps_authentication_and_private_data_boundaries(filtered):
    for sql in ("select * from app_private.company_directory", "select public.sb_discovery_admin('activate','{}')"):
        point = filtered.begin_nested()
        with pytest.raises(Exception) as caught:
            filtered.exec_driver_sql(sql)
        point.rollback()
        assert caught.value.orig.sqlstate == '42501'
    point = filtered.begin_nested()
    filtered.exec_driver_sql('SET LOCAL ROLE anon')
    with pytest.raises(Exception) as caught:
        search(filtered, 'LS')
    point.rollback()
    assert caught.value.orig.sqlstate == '42501'
