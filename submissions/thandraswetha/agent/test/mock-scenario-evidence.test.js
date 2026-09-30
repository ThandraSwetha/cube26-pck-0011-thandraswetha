import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.js";
import { loadSeedOrders, seedOrders } from "../src/data/seed-orders.js";
import { createDatabase } from "../src/storage/database.js";
import { createVisionService } from "../src/vision/mock-vision-service.js";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2kAAAAASUVORK5CYII=",
  "base64",
);

const scenarios = {
  match: { decision: "SEAL", modelStatus: "COMPLETED", quality: "GOOD", presence: "PASS", quantity: "PASS", extra: "PASS", observed: 1, uncertainCount: 0 },
  missing_item: { decision: "STOP_AND_FIX", modelStatus: "COMPLETED", quality: "GOOD", presence: "FAIL", quantity: "FAIL", extra: "PASS", observed: 0, uncertainCount: 0 },
  wrong_quantity: { decision: "STOP_AND_FIX", modelStatus: "COMPLETED", quality: "GOOD", presence: "FAIL", quantity: "FAIL", extra: "PASS", observed: 0, uncertainCount: 0 },
  extra_item: { decision: "STOP_AND_FIX", modelStatus: "COMPLETED", quality: "GOOD", presence: "PASS", quantity: "PASS", extra: "FAIL", observed: 1, uncertainCount: 0 },
  uncertain: { decision: "REVIEW", modelStatus: "COMPLETED", quality: "POOR", presence: "UNCERTAIN", quantity: "UNCERTAIN", extra: "UNCERTAIN", observed: 0, uncertainCount: 1 },
  model_failure: { decision: "REVIEW", modelStatus: "PENDING", quality: null, presence: "UNCERTAIN", quantity: "UNCERTAIN", extra: "UNCERTAIN", observed: 0, uncertainCount: 1 },
};

test("mock scenarios persist checks, vision trace, and their uploaded captures", async (context) => {
  const storage = await createDatabase();
  await seedOrders(storage, await loadSeedOrders());
  const app = createApp({ storage, vision: createVisionService() });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await storage.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  for (const [scenario, expected] of Object.entries(scenarios)) {
    const form = new FormData();
    form.set("unitId", "UNIT-0008");
    form.set("scenario", scenario);
    form.set("image", new Blob([pngBytes], { type: "image/png" }), `${scenario}.png`);
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "x-org-id": "org_demo_alpha" },
      body: form,
    });
    const result = await response.json();

    assert.equal(response.status, 201, `${scenario} HTTP status`);
    assert.equal(result.finalDecision, expected.decision, `${scenario} decision`);
    assert.equal(result.modelStatus, expected.modelStatus, `${scenario} model status`);
    assert.equal(result.imageQuality, expected.quality, `${scenario} image quality`);
    assert.equal(result.modelProvider, "mock", `${scenario} provider`);
    assert.equal(result.checks.presence.status, expected.presence, `${scenario} presence`);
    assert.equal(result.checks.quantity.status, expected.quantity, `${scenario} quantity`);
    assert.equal(result.checks.extra_items.status, expected.extra, `${scenario} extra items`);
    assert.equal(result.uncertainItems.length, expected.uncertainCount, `${scenario} uncertain items`);

    for (const [check, status] of [
      [result.checks.presence, expected.presence],
      [result.checks.quantity, expected.quantity],
    ]) {
      assert.equal(check.lines[0].sku, "SKU-BOTTLE-750", `${scenario} per-line SKU`);
      assert.equal(check.lines[0].expectedQuantity, 1, `${scenario} per-line expected quantity`);
      assert.equal(check.lines[0].observedQuantity, expected.observed, `${scenario} per-line observed quantity`);
      assert.equal(check.lines[0].status, status, `${scenario} per-line status`);
      assert.equal(typeof check.lines[0].reason, "string", `${scenario} per-line reason`);
    }

    const detailResponse = await fetch(`${baseUrl}/api/inspections/${result.id}`, {
      headers: { "x-org-id": "org_demo_alpha" },
    });
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200, `${scenario} persisted inspection`);
    assert.equal(detail.imageQuality, expected.quality, `${scenario} persisted quality`);
    assert.deepEqual(detail.uncertainItems, result.uncertainItems, `${scenario} persisted uncertainty`);
    assert.deepEqual(detail.expectedItems, result.expectedItems, `${scenario} persisted expected items`);
    assert.deepEqual(detail.detectedItems, result.detectedItems, `${scenario} persisted detections`);
    assert.deepEqual(detail.checks, result.checks, `${scenario} persisted checks`);
    assert.equal(detail.finalDecision, expected.decision, `${scenario} persisted decision`);
    assert.equal(detail.reason, result.reason, `${scenario} persisted reason`);
    assert.deepEqual(detail.evidence, result.evidence, `${scenario} persisted evidence`);

    const captureResponse = await fetch(`${baseUrl}/api/inspections/${result.id}/capture`, {
      headers: { "x-org-id": "org_demo_alpha" },
    });
    assert.equal(captureResponse.status, 200, `${scenario} capture status`);
    assert.match(captureResponse.headers.get("content-type"), /image\/png/);
    assert.deepEqual(Buffer.from(await captureResponse.arrayBuffer()), pngBytes, `${scenario} capture association`);
  }
});