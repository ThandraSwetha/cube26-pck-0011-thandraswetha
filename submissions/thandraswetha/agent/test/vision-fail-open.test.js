import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.js";
import { loadSeedOrders, seedOrders } from "../src/data/seed-orders.js";
import { createDatabase } from "../src/storage/database.js";

const imageBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2kAAAAASUVORK5CYII=",
  "base64",
);

test("provider failures and timeout save pending inspections and preserve captures", async (context) => {
  const storage = await createDatabase();
  await seedOrders(storage, await loadSeedOrders());
  let behavior = "success";
  const vision = {
    provider: "test-provider",
    analyze: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ["expectedItems", "image"]);
      if (behavior === "throws") throw new Error("provider unavailable");
      if (behavior === "timeout") return new Promise(() => {});
      if (behavior === "invalid") {
        return {
          imageQuality: "GOOD",
          detectedItems: [{
            sku: "SKU-BOTTLE-750",
            name: "Bottle",
            quantity: 1,
            confidence: 0.95,
            evidence: "Provider supplied a valid detection before its incomplete response.",
          }],
          uncertainItems: [],
        };
      }
      return {
        imageQuality: "GOOD",
        detectedItems: [{
          sku: "SKU-BOTTLE-750",
          name: "Bottle",
          quantity: 1,
          confidence: 0.95,
          evidence: "Provider detection evidence.",
        }],
        uncertainItems: [],
        evidence: ["Provider completed successfully."],
      };
    },
  };
  const app = createApp({ storage, vision, visionTimeoutMs: 30 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await storage.close();
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function submit() {
    const form = new FormData();
    form.set("unitId", "UNIT-0008");
    form.set("image", new Blob([imageBytes], { type: "image/png" }), "open-box.png");
    return fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "x-org-id": "org_demo_alpha" },
      body: form,
    });
  }

  async function assertSavedCapture(inspection) {
    const detailResponse = await fetch(`${baseUrl}/api/inspections/${inspection.id}`, {
      headers: { "x-org-id": "org_demo_alpha" },
    });
    const detail = await detailResponse.json();
    assert.equal(detailResponse.status, 200);
    assert.equal(detail.modelStatus, inspection.modelStatus);
    assert.equal(detail.modelProvider, "test-provider");
    assert.deepEqual(detail.expectedItems, inspection.expectedItems);

    const ownCapture = await fetch(`${baseUrl}/api/inspections/${inspection.id}/capture`, {
      headers: { "x-org-id": "org_demo_alpha" },
    });
    assert.equal(ownCapture.status, 200);
    assert.deepEqual(Buffer.from(await ownCapture.arrayBuffer()), imageBytes);

    const otherTenantCapture = await fetch(`${baseUrl}/api/inspections/${inspection.id}/capture`, {
      headers: { "x-org-id": "org_demo_bravo" },
    });
    assert.equal(otherTenantCapture.status, 404);
  }

  const successResponse = await submit();
  const success = await successResponse.json();
  assert.equal(successResponse.status, 201);
  assert.equal(success.modelStatus, "COMPLETED");
  assert.equal(success.finalDecision, "SEAL");
  assert.equal(success.modelProvider, "test-provider");
  await assertSavedCapture(success);

  behavior = "throws";
  const throwResponse = await submit();
  const thrown = await throwResponse.json();
  assert.equal(throwResponse.status, 201);
  assert.equal(thrown.modelStatus, "PENDING");
  assert.equal(thrown.imageQuality, null);
  assert.equal(thrown.finalDecision, "REVIEW");
  assert.match(thrown.reason, /Vision analysis failed/i);
  assert.ok(thrown.uncertainItems.length > 0);
  await assertSavedCapture(thrown);

  behavior = "invalid";
  const invalidResponse = await submit();
  const invalid = await invalidResponse.json();
  assert.equal(invalidResponse.status, 201);
  assert.equal(invalid.modelStatus, "PENDING");
  assert.equal(invalid.imageQuality, "GOOD");
  assert.equal(invalid.detectedItems.length, 1);
  assert.equal(invalid.finalDecision, "REVIEW");
  assert.match(invalid.reason, /invalid response/i);
  await assertSavedCapture(invalid);

  behavior = "timeout";
  const timeoutResponse = await submit();
  const timeout = await timeoutResponse.json();
  assert.equal(timeoutResponse.status, 201);
  assert.equal(timeout.modelStatus, "PENDING");
  assert.equal(timeout.imageQuality, null);
  assert.equal(timeout.finalDecision, "REVIEW");
  assert.match(timeout.reason, /timed out after 30 ms/i);
  assert.ok(timeout.evidence.some((item) => /timed out after 30 ms/i.test(item)));
  await assertSavedCapture(timeout);
});