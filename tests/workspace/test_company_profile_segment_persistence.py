"""Source-exact unnamed segment labels cross the real profile persistence boundary."""
import copy

import pytest
from test_company_profile_enrichment import admin, claim_and_archive, snapshot
from test_company_profile_enrichment import db as db
from test_company_profile_enrichment import enriched as enriched
from test_company_profile_enrichment import own as own
from test_company_profile_official_source import delegated as delegated
from test_company_profile_official_source import official as official

pytestmark = pytest.mark.postgres


def segment_snapshot(conn, name):
    value = snapshot(conn)
    source = value['archives'][0]
    quote = f'The Company manages and reports its business operations under a {name}.'
    source['normalized_text'] += '\n🧪\n' + quote
    start = source['normalized_text'].index(quote)
    value['result']['segments'] = [{
        'name': name, 'description': quote,
        'evidence': {'source_id': source['id'], 'quote': quote, 'location': {
            'kind': 'normalized_text', 'start': start, 'end': start + len(quote),
            'section': 'Reportable segment disclosure',
        }},
    }]
    return value


@pytest.mark.parametrize('name', [
    'single reportable operating segment',
    'Single Reportable Operating Segment',
    'SINGLE REPORTABLE OPERATING SEGMENT',
])
def test_exact_source_case_persists_with_unchanged_quote_offsets_and_archive(official, name):
    value = segment_snapshot(official, name)
    expected = copy.deepcopy(value)
    claim_and_archive(official, value)
    assert admin(official, 'save', value) == expected['result']
    cached = admin(official, 'read')['result']
    assert cached['segments'] == expected['result']['segments']
    assert cached['business'] == expected['result']['business']
    assert cached['sources'] == expected['result']['sources']
    assert value['archives'] == expected['archives']


@pytest.mark.parametrize('name', [
    'Single reportable operating segment',
    'Invented reporting segment',
])
def test_case_changed_or_invented_segment_label_remains_rejected(official, name):
    value = segment_snapshot(official, 'single reportable operating segment')
    value['result']['segments'][0]['name'] = name
    claim_and_archive(official, value)
    point = official.begin_nested()
    with pytest.raises(Exception) as caught:
        admin(official, 'save', value)
    point.rollback()
    assert caught.value.orig.sqlstate == 'PT422'
    assert caught.value.orig.diag.message_primary == 'profile_quote_mismatch'
    assert admin(official, 'read')['result'] is None
