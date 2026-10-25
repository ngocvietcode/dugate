-- Tầng Apps: schema riêng, không dùng bảng của Core (constitution L2; LAYERED_ARCHITECTURE §7)
CREATE SCHEMA IF NOT EXISTS apps;

CREATE TABLE apps.app_run (
  run_id            text PRIMARY KEY,
  app               text NOT NULL,
  app_version       text NOT NULL,
  caller            text NOT NULL,
  request_id        text NOT NULL,
  business_ref      jsonb NOT NULL,
  maker_user_id     text NOT NULL,
  review_mode       text NOT NULL,
  callback          jsonb,
  status            text NOT NULL,
  outcome           text,
  progress_percent  integer NOT NULL DEFAULT 0,
  progress_message  text NOT NULL DEFAULT '',
  findings          jsonb NOT NULL DEFAULT '[]'::jsonb,
  result            jsonb,
  open_tasks        integer NOT NULL DEFAULT 0,
  error             jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,                         -- TTL dữ liệu làm việc (L5)
  CONSTRAINT app_run_idem UNIQUE (caller, app, request_id)
);
CREATE INDEX app_run_business_ref_idx ON apps.app_run ((business_ref->>'system'), (business_ref->>'id'));
CREATE INDEX app_run_status_idx ON apps.app_run (status);

CREATE TABLE apps.review_task (
  task_id     text PRIMARY KEY,
  run_id      text NOT NULL REFERENCES apps.app_run(run_id),
  kind        text NOT NULL,
  ref         text NOT NULL,
  severity    text,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN',
  decided_by  text,
  decision    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  done_at     timestamptz,
  CONSTRAINT review_task_unique UNIQUE (run_id, kind, ref)
);
CREATE INDEX review_task_run_idx ON apps.review_task (run_id, status);

-- Audit nghiệp vụ: append-only, chuỗi hash (constitution §8)
CREATE TABLE apps.app_audit_event (
  seq             bigserial PRIMARY KEY,
  run_id          text,
  actor           text NOT NULL,
  action          text NOT NULL,
  object          text NOT NULL,
  before          jsonb,
  after           jsonb,
  reason          text,
  correlation_id  text,
  at              timestamptz NOT NULL,
  prev_hash       text NOT NULL,
  hash            text NOT NULL UNIQUE
);
CREATE INDEX app_audit_run_idx ON apps.app_audit_event (run_id, seq);

CREATE FUNCTION apps.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'apps.app_audit_event là append-only';
END $$;
CREATE TRIGGER app_audit_no_update BEFORE UPDATE OR DELETE ON apps.app_audit_event
  FOR EACH ROW EXECUTE FUNCTION apps.forbid_change();
CREATE TRIGGER app_audit_no_truncate BEFORE TRUNCATE ON apps.app_audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION apps.forbid_change();
