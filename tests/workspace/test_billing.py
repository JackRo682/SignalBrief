"""Real PostgreSQL authorization checks for the additive payment ledger."""
import pytest
from sqlalchemy import text
from test_workspace_schema import A
from test_workspace_schema import db as db
from test_workspace_schema import own as own

pytestmark = pytest.mark.postgres


def test_billing_reservations_are_owned_and_retries_reuse_them(own):
    first = own.execute(text('SELECT sb_checkout_reserve(false)')).scalar_one()
    retry = own.execute(text('SELECT sb_checkout_reserve(false)')).scalar_one()
    assert first['create'] is True
    assert retry['id'] == first['id']
    assert retry['create'] is False
    assert own.execute(text('SELECT sb_billing_status()')).scalar_one()['active'] is False
    own.exec_driver_sql('RESET ROLE')
    assert own.execute(text('SELECT user_id FROM billing_orders WHERE id=:id'), {'id': first['id']}).scalar_one() == A


def test_users_cannot_write_payment_confirmations_or_read_ledger(own):
    for statement in ('SELECT * FROM billing_orders', "SELECT sb_checkout_publish(gen_random_uuid(),'https://demo.lemonsqueezy.com/checkout/a')", "SELECT sb_payment_record(null,repeat('a',64),'1',false,now(),false)"):
        point = own.begin_nested()
        with pytest.raises(Exception) as error:
            own.execute(text(statement))
        point.rollback()
        assert error.value.orig.sqlstate == '42501'
