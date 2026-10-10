-- SYNTHETIC ONLY. Temporary projections of audited public tables, not a migration.
-- Missing foreign keys are intentional ONLY here to inject corrupt rows for Q16/Q17.
CREATE TEMP TABLE users(id varchar(36) PRIMARY KEY, created_at timestamptz NOT NULL, analytics_consent boolean NOT NULL);
CREATE TEMP TABLE user_events(id varchar(36) PRIMARY KEY, user_id varchar(36) NOT NULL, event_name varchar(60) NOT NULL, properties json NOT NULL, created_at timestamptz NOT NULL);
CREATE TEMP TABLE watchlists(id varchar(36) PRIMARY KEY, user_id varchar(36) NOT NULL);
CREATE TEMP TABLE watchlist_items(watchlist_id varchar(36), company_id varchar(36), PRIMARY KEY(watchlist_id,company_id));
CREATE TEMP TABLE ai_runs(id varchar(36) PRIMARY KEY, document_id varchar(36), stage varchar(40), status varchar(30), created_at timestamptz, finished_at timestamptz);
CREATE TEMP TABLE documents(id varchar(36) PRIMARY KEY, source_url text);
CREATE TEMP TABLE document_chunks(id varchar(36) PRIMARY KEY, document_id varchar(36), text text);
CREATE TEMP TABLE facts(id varchar(36) PRIMARY KEY, chunk_id varchar(36), quote text, unit varchar(40));
CREATE TEMP TABLE changes(id varchar(36) PRIMARY KEY, change_type varchar(40), previous_value text, current_value text, absolute_change varchar(100), percentage_change varchar(100), current_fact_id varchar(36), previous_fact_id varchar(36));
-- Proposed contracts below DO NOT EXIST in SignalBrief production.
CREATE TEMP TABLE signup_attempts(id text PRIMARY KEY, started_at timestamptz NOT NULL, completed_at timestamptz);
CREATE TEMP TABLE claim_reviews(claim_id text, kind text, verdict text, sampled_at timestamptz, reviewed_at timestamptz, PRIMARY KEY(claim_id,kind));

INSERT INTO users VALUES
 ('u1','2026-01-01 00:00Z',true),('u2','2026-01-02 00:00Z',true),('u3','2026-01-03 00:00Z',true),
 ('u4','2026-01-01 00:00Z',false),('u5','2026-01-10 00:00Z',true),('u6','2026-01-08 00:00Z',true);
INSERT INTO watchlists VALUES ('w1','u1'),('w2','u2'),('w3','u3'),('w4','u4'),('w1b','u1');
INSERT INTO watchlist_items VALUES ('w1','c1'),('w1','c2'),('w1b','c1'),('w2','c1'),('w4','c3');
INSERT INTO user_events VALUES
 ('01','u1','watchlist_added','{"company_id":"c1"}','2026-01-01 01:00Z'),
 ('02','u1','brief_opened','{"event_id":"e1"}','2026-01-01 02:00Z'),
 ('03','u1','brief_opened','{"event_id":"e1"}','2026-01-01 03:00Z'),
 ('04','u1','evidence_opened','{"event_id":"e1"}','2026-01-01 04:00Z'),
 ('05','u1','followup_asked','{"event_id":"e1"}','2026-01-01 05:00Z'),
 ('06','u1','feedback_submitted','{"event_id":"e1"}','2026-01-01 06:00Z'),
 ('07','u1','feedback_submitted','{"event_id":"e1"}','2026-01-01 07:00Z'),
 ('08','u1','brief_opened','{"event_id":"e2"}','2026-01-02 00:00Z'),
 ('09','u1','evidence_opened','{"event_id":"e2"}','2026-01-03 00:00Z'),
 ('10','u2','evidence_opened','{"event_id":"e1"}','2026-01-02 01:00Z'),
 ('11','u2','brief_opened','{"event_id":"e1"}','2026-01-02 02:00Z'),
 ('12','u2','watchlist_added','{"company_id":"c1"}','2026-01-02 03:00Z'),
 ('13','u2','feedback_submitted','{"event_id":"e1"}','2026-01-02 05:00Z'),
 ('14','u3','brief_opened','{"event_id":"e2"}','2026-01-03 02:00Z'),
 ('15','u3','evidence_opened','{"event_id":"e2"}','2026-01-03 03:00Z'),
 ('16','u3','followup_asked','{"event_id":"e2"}','2026-01-04 04:00Z'),
 ('17','u1','brief_opened','{"event_id":"e1"}','2026-01-08 00:00Z'),
 ('18','u2','brief_opened','{"event_id":"e1"}','2026-01-10 00:00Z'),
 ('19','u3','login','{}','2026-01-10 00:00Z'),
 ('20','u4','brief_opened','{"event_id":"e1"}','2026-01-01 02:00Z'),
 ('21','u6','brief_opened','{"event_id":"e1"}','2026-01-09 01:00Z');
INSERT INTO ai_runs VALUES
 ('a1','d1','extract_validate_compare','failed','2026-01-02 00:00Z','2026-01-02 01:00Z'),
 ('a2','d1','extract_validate_compare','validated','2026-01-03 00:00Z','2026-01-03 01:00Z'),
 ('a3','d2','extract_validate_compare','validation_failed','2026-01-04 00:00Z','2026-01-04 01:00Z'),
 ('a4','d3','extract_validate_compare','running','2026-01-05 00:00Z',NULL),
 ('a5','d1','extract_validate_compare','duplicate_skipped','2026-01-03 00:00Z','2026-01-03 01:00Z'),
 ('a6','d1','followup','failed','2026-01-06 00:00Z','2026-01-06 01:00Z'),
 ('a7','d4','extract_validate_compare','validated','2026-01-12 00:00Z','2026-01-12 01:00Z');
INSERT INTO signup_attempts VALUES
 ('s1','2026-01-01 00:00Z','2026-01-01 01:00Z'),('s2','2026-01-02 00:00Z',NULL),
 ('s3','2026-01-03 00:00Z','2026-01-04 00:00Z'),('s4','2026-01-11 20:00Z',NULL),
 ('s5','2026-01-01 00:00Z','2025-12-31 00:00Z');
INSERT INTO claim_reviews VALUES
 ('r1','citation','pass','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r2','citation','fail','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r3','citation','unreviewed','2026-01-02 00:00Z',NULL),
 ('r4','citation','pass','2026-01-02 00:00Z','2026-01-13 00:00Z'),
 ('r1','numeric','pass','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r2','numeric','pass','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r3','numeric','fail','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r4','numeric','not_applicable','2026-01-02 00:00Z','2026-01-03 00:00Z'),
 ('r5','numeric','unreviewed','2026-01-02 00:00Z',NULL);
INSERT INTO documents VALUES ('d1','https://example.test/synthetic'),('d2','');
INSERT INTO document_chunks VALUES ('c1','d1','Synthetic revenue was 100.'),('c2','d2','Other synthetic quote.');
INSERT INTO facts(id,chunk_id,quote) VALUES ('f1','c1','revenue was 100'),('f2','c1','invented quote'),('f3','missing','quote'),('f4','c2','Other synthetic quote.'),('f5','c1','');
INSERT INTO changes(id,change_type,previous_value,current_value,absolute_change,percentage_change) VALUES
 ('n1','increased','90','100','10','11.11111111'),
 ('n2','increased','0','10','10',NULL),
 ('n3','increased','0','10','10','100'),
 ('n4','increased','90','100','9','11.11111111'),
 ('n5','increased','90','100','10','12'),
 ('n6','increased','unknown','100','10',NULL),
 ('n7','increased','-10','-5','5','50'),
 ('n8','wording_changed',NULL,NULL,NULL,NULL);

UPDATE facts SET unit='USD';
UPDATE changes SET current_fact_id='f1',previous_fact_id='f1';
