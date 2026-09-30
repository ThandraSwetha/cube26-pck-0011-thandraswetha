CREATE TABLE IF NOT EXISTS orders (
  org_id text NOT NULL,
  unit_id text NOT NULL,
  order_id text NOT NULL,
  channel text NOT NULL,
  expected_items jsonb NOT NULL,
  PRIMARY KEY (org_id, unit_id)
);

CREATE TABLE IF NOT EXISTS inspections (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  unit_id text NOT NULL,
  order_id text NOT NULL,
  created_at timestamptz NOT NULL,
  model_status text NOT NULL,
  model_provider text NOT NULL,
  image_quality text,
  uncertain_items jsonb,
  expected_items jsonb NOT NULL,
  detected_items jsonb NOT NULL,
  checks jsonb NOT NULL,
  final_decision text NOT NULL,
  reason text NOT NULL,
  evidence jsonb NOT NULL
);

ALTER TABLE inspections ADD COLUMN IF NOT EXISTS image_quality text;
ALTER TABLE inspections ADD COLUMN IF NOT EXISTS uncertain_items jsonb;

CREATE TABLE IF NOT EXISTS captures (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  inspection_id text NOT NULL,
  content_sha256 text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  image_base64 text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (inspection_id) REFERENCES inspections (id)
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections FORCE ROW LEVEL SECURITY;
ALTER TABLE captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE captures FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orders_org_scope ON orders;
CREATE POLICY orders_org_scope ON orders
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

DROP POLICY IF EXISTS inspections_org_scope ON inspections;
CREATE POLICY inspections_org_scope ON inspections
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

DROP POLICY IF EXISTS captures_org_scope ON captures;
CREATE POLICY captures_org_scope ON captures
  USING (org_id = current_setting('app.org_id', true))
  WITH CHECK (org_id = current_setting('app.org_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON orders, inspections, captures TO pack_manager_app;