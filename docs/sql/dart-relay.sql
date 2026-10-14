CREATE TABLE IF NOT EXISTS app_private.dart_relay_nonces(nonce text PRIMARY KEY,expires_at timestamptz NOT NULL);
REVOKE ALL ON app_private.dart_relay_nonces FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sb_dart_relay_claim(body_text text,request_timestamp text,signature text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text;payload jsonb;BEGIN
 IF length(body_text)>4096 OR request_timestamp !~ '^[0-9]{13}$' OR signature !~ '^[a-f0-9]{64}$' THEN RETURN false;END IF;
 IF abs(extract(epoch from clock_timestamp())*1000-request_timestamp::numeric)>60000 THEN RETURN false;END IF;
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='signalbrief::DART_RELAY_SECRET';
 IF secret IS NULL OR length(secret)<64 OR encode(extensions.hmac(request_timestamp||E'\n'||body_text,secret,'sha256'),'hex')<>signature THEN RETURN false;END IF;
 BEGIN payload:=body_text::jsonb;EXCEPTION WHEN OTHERS THEN RETURN false;END;
 IF payload->>'nonce' IS NULL OR payload->>'nonce' !~ '^[a-f0-9]{64}$' THEN RETURN false;END IF;
 DELETE FROM app_private.dart_relay_nonces WHERE expires_at<now();
 INSERT INTO app_private.dart_relay_nonces VALUES(payload->>'nonce',now()+interval '2 minutes') ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.sb_dart_relay_claim(text,text,text) FROM PUBLIC;
-- Custom HMAC authentication is verified in this function; these roles see no key or nonce records.
GRANT EXECUTE ON FUNCTION public.sb_dart_relay_claim(text,text,text) TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.sb_us_secrets() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(substring(name from 14),decrypted_secret),'{}'::jsonb) FROM vault.decrypted_secrets WHERE name IN
 ('signalbrief::OPENAI_API_KEY','signalbrief::FMP_API_KEY','signalbrief::RESEND_API_KEY','signalbrief::GNEWS_API_KEY','signalbrief::SEC_CONTACT_EMAIL','signalbrief::DART_API_KEY','signalbrief::RESEND_WEBHOOK_SECRET','signalbrief::KIS_APP_KEY','signalbrief::KIS_APP_SECRET','signalbrief::DART_RELAY_SECRET')
$$;
REVOKE ALL ON FUNCTION public.sb_us_secrets() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sb_us_secrets() TO service_role;
NOTIFY pgrst,'reload schema';
