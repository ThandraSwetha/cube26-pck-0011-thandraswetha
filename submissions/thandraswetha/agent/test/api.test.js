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

test("API enforces tenant scoping and saves evidence, including pending model failures", async (context) => {
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
  const missingTenant = await fetch(`${baseUrl}/api/orders`);
  assert.equal(missingTenant.status, 400);

  const alphaOrdersResponse = await fetch(`${baseUrl}/api/orders`, { headers: { "x-org-id": "org_demo_alpha" } });
  const alphaOrders = await alphaOrdersResponse.json();
  assert.equal(alphaOrdersResponse.status, 200);
  assert.ok(alphaOrders.some((order) => order.unitId === "UNIT-0008"));
  assert.ok(!alphaOrders.some((order) => order.unitId === "UNIT-0006"));

  const deniedOrder = await fetch(`${baseUrl}/api/orders/UNIT-0008`, { headers: { "x-org-id": "org_demo_bravo" } });
  assert.equal(deniedOrder.status, 404);

  async function submitScenario(scenario) {
    const form = new FormData();
    form.set("unitId", "UNIT-0008");
    form.set("scenario", scenario);
    form.set("image", new Blob([pngBytes], { type: "image/png" }), "open-box.png");
    return fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "x-org-id": "org_demo_alpha" },
      body: form,
    });
  }

  const matchResponse = await submitScenario("match");
  const match = await matchResponse.json();
  assert.equal(matchResponse.status, 201);
  assert.equal(match.finalDecision, "SEAL");
  assert.equal(match.modelProvider, "mock");
  assert.ok(match.evidence.some((item) => item.includes("SHA-256")));

  const ownCapture = await fetch(`${baseUrl}/api/inspections/${match.id}/capture`, {
    headers: { "x-org-id": "org_demo_alpha" },
  });
  const otherCapture = await fetch(`${baseUrl}/api/inspections/${match.id}/capture`, {
    headers: { "x-org-id": "org_demo_bravo" },
  });
  assert.equal(ownCapture.status, 200);
  assert.equal(otherCapture.status, 404);

  const failureResponse = await submitScenario("model_failure");
  const failure = await failureResponse.json();
  assert.equal(failureResponse.status, 201);
  assert.equal(failure.modelStatus, "PENDING");
  assert.equal(failure.finalDecision, "REVIEW");

  const history = await fetch(`${baseUrl}/api/inspections`, { headers: { "x-org-id": "org_demo_alpha" } });
  const records = await history.json();
  assert.equal(history.status, 200);
  assert.equal(records.length, 2);
  assert.ok(records.some((record) => record.modelStatus === "PENDING"));
});