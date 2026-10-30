"""Real PostgreSQL replay for metadata visibility, aliases and user isolation."""
import pytest
from sqlalchemy import text
from test_workspace_schema import A, B, C, rpc
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres


def test_collected_metadata_does_not_require_published_analysis(own):
    # Synthetic baseline filing exists, with no published analysis.
    own.execute(text("SELECT public.sb_user_action('watch_add',jsonb_build_object('company_id',:c))"), {'c': C})
    result = rpc(own, 'source_overview')
    assert result['companies'] == result['filing_count'] == 1
    assert result['published_count'] == 0
    assert len(result['filings']) == 1
    assert result['historical_events'] == []
    assert 'source_object_key' not in str(result)
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': B})
    assert rpc(own, 'source_overview')['filings'] == []
    own.execute(text("SELECT set_config('request.jwt.claim.sub',:u,true)"), {'u': A})
    point = own.begin_nested()
    with pytest.raises(Exception) as error:
        rpc(own, 'source_overview', {'user_id': B})
    point.rollback()
    assert error.value.orig.sqlstate == 'PT422'


def test_korean_aliases_and_markets(own):
    own.exec_driver_sql('RESET ROLE')
    own.exec_driver_sql("""INSERT INTO companies
        (id,name,ticker,market,provider,provider_company_id,is_demo,created_at)
        VALUES ('20000000-0000-4000-8000-000000000091','삼성전자','005930','KRX','dart','00126380',false,now())""")
    own.exec_driver_sql('SET LOCAL ROLE authenticated')
    assert rpc(own, 'company_lookup', {'q': '삼전'})[0]['ticker'] == '005930'
    assert rpc(own, 'catalog', {'q': 'samsung electronics', 'kind': 'company'})['items'][0]['ticker'] == '005930'
    assert 'KRX' in rpc(own, 'catalog')['markets']
    assert rpc(own, 'company_lookup', {'q': "x'); select * from users; --"}) == []
    assert all(not row['is_demo'] for row in rpc(own, 'company_lookup'))
