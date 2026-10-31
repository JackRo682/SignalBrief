-- Additive ledger. No existing data or free capability is changed.
CREATE TABLE public.billing_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 test boolean NOT NULL,
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','checkout','paid','refunded')),
 checkout_url text, created_at timestamptz NOT NULL DEFAULT now(),
 checkout_expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 provider_id text UNIQUE, paid_at timestamptz, expires_at timestamptz, refunded_at timestamptz
);
CREATE INDEX billing_orders_user_mode ON public.billing_orders(user_id,test,created_at DESC);
CREATE TABLE app_private.billing_events(event_hash text PRIMARY KEY,order_id uuid NOT NULL REFERENCES public.billing_orders(id) ON DELETE CASCADE,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.billing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.billing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_orders,app_private.billing_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.sb_billing_status() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=auth.uid()::text;r jsonb;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();
 SELECT jsonb_build_object('active',coalesce(bool_or(NOT test AND expires_at>now()),false),'expires_at',max(expires_at) FILTER(WHERE NOT test AND expires_at>now()),'test_active',coalesce(bool_or(test AND expires_at>now()),false),'test_expires_at',max(expires_at) FILTER(WHERE test AND expires_at>now())) INTO r
 FROM public.billing_orders WHERE user_id=u AND state='paid' AND refunded_at IS NULL;
 RETURN r;
END$$;
CREATE FUNCTION public.sb_checkout_reserve(is_test boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE u text:=auth.uid()::text; existing public.billing_orders%rowtype;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE='PT401';END IF;
 PERFORM public.sb_require_mfa();PERFORM public.sb_rate_limit();
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=u) THEN PERFORM public.sb_initialize_profile();END IF;
 PERFORM 1 FROM public.users WHERE id=u FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'profile_required' USING ERRCODE='PT409';END IF;
 IF is_test IS NULL THEN RAISE EXCEPTION 'invalid_mode' USING ERRCODE='PT422';END IF;
 IF EXISTS(SELECT 1 FROM public.billing_orders WHERE user_id=u AND test=is_test AND state='paid' AND refunded_at IS NULL AND expires_at>now()) THEN RAISE EXCEPTION 'pass_already_active' USING ERRCODE='PT409';END IF;
 SELECT * INTO existing FROM public.billing_orders WHERE user_id=u AND test=is_test AND state IN ('creating','checkout') AND checkout_expires_at>now() ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('id',existing.id,'url',existing.checkout_url,'create',false);END IF;
 IF (SELECT count(*) FROM public.billing_orders WHERE user_id=u AND created_at>now()-interval '1 day')>=5 THEN RAISE EXCEPTION 'checkout_daily_limit' USING ERRCODE='PT429';END IF;
 INSERT INTO public.billing_orders(user_id,test) VALUES(u,is_test) RETURNING * INTO existing;
 RETURN jsonb_build_object('id',existing.id,'url',null,'create',true);
END$$;
CREATE FUNCTION public.sb_checkout_publish(oid uuid,checkout_url text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF checkout_url !~ '^https://[a-zA-Z0-9-]+[.]lemonsqueezy[.]com/checkout/' OR length(checkout_url)>4096 THEN RAISE EXCEPTION 'invalid_checkout_url';END IF;
 UPDATE public.billing_orders b SET checkout_url=sb_checkout_publish.checkout_url,state='checkout' WHERE b.id=oid AND state='creating' AND checkout_expires_at>now();
 IF NOT FOUND THEN RAISE EXCEPTION 'checkout_reservation_unavailable';END IF;
END$$;
CREATE FUNCTION public.sb_payment_record(oid uuid,event_hash text,provider_id text,test boolean,paid_at timestamptz,refunded boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE entry public.billing_orders%rowtype;
BEGIN
 IF event_hash !~ '^[a-f0-9]{64}$' OR provider_id !~ '^[0-9]{1,30}$' OR test IS NULL OR refunded IS NULL OR paid_at IS NULL OR paid_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid_payment_record';END IF;
 SELECT * INTO entry FROM public.billing_orders b WHERE (oid IS NOT NULL AND b.id=oid) OR (oid IS NULL AND b.provider_id=sb_payment_record.provider_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'payment_reservation_not_found';END IF;
 IF entry.test<>test OR entry.provider_id IS NOT NULL AND entry.provider_id<>provider_id THEN RAISE EXCEPTION 'payment_identity_mismatch';END IF;
 INSERT INTO app_private.billing_events(event_hash,order_id) VALUES(event_hash,entry.id) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN;END IF;
 -- Refund is terminal; replayed paid events can never restore access.
 UPDATE public.billing_orders b SET provider_id=sb_payment_record.provider_id,
 paid_at=coalesce(b.paid_at,sb_payment_record.paid_at),expires_at=coalesce(b.expires_at,sb_payment_record.paid_at+interval '30 days'),
 state=CASE WHEN refunded OR b.refunded_at IS NOT NULL THEN 'refunded' ELSE 'paid' END,
 refunded_at=CASE WHEN refunded THEN coalesce(b.refunded_at,now()) ELSE b.refunded_at END WHERE b.id=entry.id;
END$$;
REVOKE ALL ON FUNCTION public.sb_billing_status(),public.sb_checkout_reserve(boolean),public.sb_checkout_publish(uuid,text),public.sb_payment_record(uuid,text,text,boolean,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_billing_status(),public.sb_checkout_reserve(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sb_checkout_publish(uuid,text),public.sb_payment_record(uuid,text,text,boolean,timestamptz,boolean) TO service_role;
