import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/storage/database.js";

test("forced row-level security hides another organization's orders and image captures", async (context) => {
  const storage = await createDatabase();
  context.after(() => storage.close());

  await storage.db.query(
    `INSERT INTO orders (org_id, unit_id, order_id, channel, expected_items)
     VALUES ('org_demo_alpha', 'UNIT-ALPHA', 'ORD-ALPHA', 'shopify', '[]'::jsonb)`,
  );
  await storage.db.query(
    `INSERT INTO inspections (
       id, org_id, unit_id, order_id, created_at, model_status, model_provider,
       expected_items, detected_items, checks, final_decision, reason, evidence
     ) VALUES (
       'inspection-alpha', 'org_demo_alpha', 'UNIT-ALPHA', 'ORD-ALPHA', now(), 'COMPLETED', 'mock',
       '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'REVIEW', 'test', '[]'::jsonb
     )`,
  );
  await storage.db.query(
    `INSERT INTO captures (
       id, org_id, inspection_id, content_sha256, original_name, mime_type, image_base64, created_at
     ) VALUES ('capture-alpha', 'org_demo_alpha', 'inspection-alpha', 'hash', 'test.png', 'image/png', 'AA==', now())`,
  );

  const alphaOrders = await storage.withTenant("org_demo_alpha", ({ query }) =>
    query("SELECT unit_id FROM orders WHERE unit_id = $1", ["UNIT-ALPHA"]));
  const bravoOrders = await storage.withTenant("org_demo_bravo", ({ query }) =>
    query("SELECT unit_id FROM orders WHERE unit_id = $1", ["UNIT-ALPHA"]));
  const bravoCaptures = await storage.withTenant("org_demo_bravo", ({ query }) =>
    query("SELECT id FROM captures WHERE id = $1", ["capture-alpha"]));

  assert.equal(alphaOrders.rows.length, 1);
  assert.equal(bravoOrders.rows.length, 0);
  assert.equal(bravoCaptures.rows.length, 0);

  await assert.rejects(
    storage.withTenant("org_demo_bravo", ({ query }) => query(
      `INSERT INTO inspections (
         id, org_id, unit_id, order_id, created_at, model_status, model_provider,
         expected_items, detected_items, checks, final_decision, reason, evidence
       ) VALUES (
         'cross-tenant', 'org_demo_alpha', 'UNIT-ALPHA', 'ORD-ALPHA', now(), 'PENDING', 'mock',
         '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'REVIEW', 'test', '[]'::jsonb
       )`,
    )),
    /row-level security/i,
  );
});