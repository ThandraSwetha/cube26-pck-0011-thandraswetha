import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/api/app.js";
import { loadSeedOrders, seedOrders } from "../src/data/seed-orders.js";
import { createDatabase } from "../src/storage/database.js";
import { createVisionProvider } from "../src/vision/provider-factory.js";
import { parseGeminiVisionResponse } from "../src/vision/gemini-vision-service.js";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAO+/p2kAAAAASUVORK5CYII=",
  "base64",
);

const result = {
  imageQuality: "GOOD",
  detectedItems: [{
    sku: "SKU-BOTTLE-750",
    name: "Bottle",
    quantity: 1,
    confidence: 0.95,
    evidence: "One bottle is visible in the package.",
  }],
  uncertainItems: [],
  evidence: ["Package contents are clearly visible."],
};

test("Gemini provider sends a multimodal image request and validates structured observations", async () => {
  let requestUrl;
  let request;
  const provider = createVisionProvider("gemini", {
    geminiApiKey: "test-gemini-key",
    geminiModel: "gemini-3.5-flash-lite",
    geminiApiKeySource: "project .env",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      request = options;
      return {
        ok: true,
        json: async () => ({
          modelVersion: "gemini-3.5-flash-lite",
          candidates: [{
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(result) }] },
          }],
        }),
      };
    },
  });

  const parsed = await provider.analyze({
    image,
    mimeType: "image/png",
    expectedItems: [{ sku: "SKU-BOTTLE-750", name: "Bottle", quantity: 1 }],
  });

  assert.equal(requestUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
  assert.equal(request.headers["x-goog-api-key"], "test-gemini-key");
  assert.equal(request.headers.authorization, undefined);
  const body = JSON.parse(request.body);
  assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/png");
  assert.equal(body.contents[0].parts[1].inlineData.data, image.toString("base64"));
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.deepEqual(body.generationConfig.responseSchema, {
    type: "OBJECT",
    required: ["imageQuality", "detectedItems", "uncertainItems", "evidence"],
    properties: {
      imageQuality: { type: "STRING", enum: ["GOOD", "POOR"] },
      detectedItems: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["sku", "name", "quantity", "confidence", "evidence"],
          properties: {
            sku: { type: "STRING" },
            name: { type: "STRING" },
            quantity: { type: "INTEGER" },
            confidence: { type: "NUMBER" },
            evidence: { type: "STRING" },
          },
        },
      },
      uncertainItems: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          required: ["possibleSkus", "reason"],
          properties: {
            possibleSkus: { type: "ARRAY", items: { type: "STRING" } },
            reason: { type: "STRING" },
          },
        },
      },
      evidence: { type: "ARRAY", items: { type: "STRING" } },
    },
  });
  assert.deepEqual(parsed.detectedItems, result.detectedItems);
  assert.ok(parsed.evidence.some((item) => item.includes("Gemini generateContent")));
  assert.equal(Object.hasOwn(parsed, "finalDecision"), false);
});

test("Gemini defaults to gemini-3.5-flash-lite when no model is configured", () => {
  const provider = createVisionProvider("gemini", { geminiApiKey: "test-gemini-key" });
  assert.equal(provider.configurationDiagnostics.model, "gemini-3.5-flash-lite");
  assert.equal(
    provider.configurationDiagnostics.endpoint,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
  );
});

test("Gemini response parsing rejects invalid structured output", () => {
  assert.throws(() => parseGeminiVisionResponse({ candidates: [] }), /usable visual analysis/i);
  assert.throws(() => parseGeminiVisionResponse({
    candidates: [{ content: { parts: [{ text: "not JSON" }] } }],
  }), /valid JSON/i);
  assert.throws(() => parseGeminiVisionResponse({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            ...result,
            detectedItems: [{ ...result.detectedItems[0], quantity: -1 }],
          }),
        }],
      },
    }],
  }), /invalid detected item/i);
});

test("Gemini API failures surface quota details but suppress authentication response text", async () => {
  const quotaProvider = createVisionProvider("gemini", {
    geminiApiKey: "private-gemini-key",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Quota exceeded." } }),
    }),
  });
  const input = {
    image,
    mimeType: "image/png",
    expectedItems: [{ sku: "SKU-BOTTLE-750", name: "Bottle", quantity: 1 }],
  };
  await assert.rejects(quotaProvider.analyze(input), (error) => {
    assert.equal(error.diagnostic.status, 429);
    assert.equal(error.diagnostic.message, "Quota exceeded.");
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /private-gemini-key/);
    return true;
  });

  const authProvider = createVisionProvider("gemini", {
    geminiApiKey: "private-gemini-key",
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: "private-gemini-key is invalid." } }),
    }),
  });
  await assert.rejects(authProvider.analyze(input), (error) => {
    assert.equal(error.diagnostic.status, 403);
    assert.equal(error.diagnostic.message, "Gemini API returned HTTP 403.");
    assert.doesNotMatch(JSON.stringify(error), /private-gemini-key/);
    return true;
  });
});

test("Gemini timeout fails open and preserves uploaded image and hash evidence", async (context) => {
  const storage = await createDatabase();
  await seedOrders(storage, await loadSeedOrders());
  let requestAborted = false;
  const vision = createVisionProvider("gemini", {
    geminiApiKey: "private-gemini-key",
    fetchImpl: (_url, { signal }) => new Promise((_, reject) => {
      const abort = () => {
        requestAborted = true;
        reject(signal.reason);
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }),
  });
  const app = createApp({ storage, vision, visionTimeoutMs: 30 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await storage.close();
  });

  const form = new FormData();
  form.set("unitId", "UNIT-0008");
  form.set("image", new Blob([image], { type: "image/png" }), "open-box.png");
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`, {
    method: "POST",
    headers: { "x-org-id": "org_demo_alpha" },
    body: form,
  });
  const inspection = await response.json();

  assert.equal(response.status, 201);
  assert.equal(inspection.modelProvider, "gemini");
  assert.equal(inspection.modelStatus, "PENDING");
  assert.equal(inspection.finalDecision, "REVIEW");
  assert.equal(requestAborted, true);
  assert.ok(inspection.evidence.some((item) =>
    item === `Uploaded image SHA-256: ${createHash("sha256").update(image).digest("hex")}`));

  const capture = await fetch(
    `http://127.0.0.1:${server.address().port}/api/inspections/${inspection.id}/capture`,
    { headers: { "x-org-id": "org_demo_alpha" } },
  );
  assert.equal(capture.status, 200);
  assert.deepEqual(Buffer.from(await capture.arrayBuffer()), image);
});
