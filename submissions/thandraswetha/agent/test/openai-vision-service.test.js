import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/api/app.js";
import { loadSeedOrders, seedOrders } from "../src/data/seed-orders.js";
import { createDatabase } from "../src/storage/database.js";
import { createVisionProvider } from "../src/vision/provider-factory.js";
import { parseOpenAIVisionResponse } from "../src/vision/openai-vision-service.js";

const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p2kAAAAASUVORK5CYII=",
  "base64",
);

const structuredResult = {
  imageQuality: "GOOD",
  detectedItems: [{
    sku: "SKU-BOTTLE-750",
    name: "Bottle",
    quantity: 1,
    confidence: 0.95,
    evidence: "One bottle is visibly present.",
  }],
  uncertainItems: [],
  evidence: ["Package contents are in focus."],
};

test("OpenAI vision provider sends the image and parses validated structured output", async () => {
  let requestUrl;
  let request;
  const provider = createVisionProvider("real", {
    apiKey: "test-key",
    model: "test-vision-model",
    fetchImpl: async (url, options) => {
      requestUrl = url;
      request = options;
      return {
        ok: true,
        json: async () => ({
          id: "resp_test123",
          status: "completed",
          output_text: JSON.stringify(structuredResult),
        }),
      };
    },
  });

  const result = await provider.analyze({
    image,
    mimeType: "image/png",
    expectedItems: [{ sku: "SKU-BOTTLE-750", name: "Bottle", quantity: 1 }],
  });

  assert.equal(requestUrl, "https://api.openai.com/v1/responses");
  assert.deepEqual(provider.configurationDiagnostics, {
    apiKeyPresent: true,
    apiKeyLength: 8,
    apiKeyStartsWithSk: false,
    apiKeyHasLeadingOrTrailingWhitespace: false,
    apiKeyContainsQuotes: false,
    apiKeyContainsLineBreak: false,
    apiKeyContainsOtherControlCharacters: false,
    apiKeySource: "unknown",
    baseUrl: "https://api.openai.com/v1",
    endpoint: "https://api.openai.com/v1/responses",
    model: "test-vision-model",
  });
  assert.ok(!JSON.stringify(provider.configurationDiagnostics).includes("test-key"));
  assert.equal(request.headers.authorization, "Bearer test-key");
  const body = JSON.parse(request.body);
  assert.equal(body.model, "test-vision-model");
  assert.equal(body.input[1].content[1].image_url, `data:image/png;base64,${image.toString("base64")}`);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(result.detectedItems, structuredResult.detectedItems);
  assert.ok(result.evidence.some((item) => item.includes("resp_test123")));
  assert.deepEqual(Object.keys(result).sort(), ["detectedItems", "evidence", "imageQuality", "uncertainItems"]);
});

test("OpenAI vision response parser rejects malformed and unsafe model results", () => {
  assert.throws(
    () => parseOpenAIVisionResponse({ output_text: "not JSON" }),
    /valid JSON/i,
  );
  assert.throws(
    () => parseOpenAIVisionResponse({
      output_text: JSON.stringify({
        ...structuredResult,
        detectedItems: [{ ...structuredResult.detectedItems[0], quantity: -1 }],
      }),
    }),
    /invalid detected item/i,
  );
  assert.throws(
    () => parseOpenAIVisionResponse({
      output_text: JSON.stringify({ ...structuredResult, finalDecision: "SEAL" }),
    }),
    /invalid object shape/i,
  );
  assert.throws(
    () => parseOpenAIVisionResponse({
      output_text: JSON.stringify(structuredResult),
      output: [{ type: "message", content: [{ type: "refusal", refusal: "Refused." }] }],
    }),
    /was refused/i,
  );
});

test("OpenAI vision provider surfaces API failures and missing credentials", async () => {
  const unavailable = createVisionProvider("real", {
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: { message: "Service unavailable." } }),
    }),
  });
  const input = {
    image,
    mimeType: "image/png",
    expectedItems: [{ sku: "SKU-BOTTLE-750", name: "Bottle", quantity: 1 }],
  };
  await assert.rejects(unavailable.analyze(input), (error) => {
    assert.match(error.message, /HTTP 503/i);
    assert.equal(error.diagnostic.status, 503);
    assert.equal(error.diagnostic.message, "Service unavailable.");
    return true;
  });

  const networkFailure = createVisionProvider("real", {
    apiKey: "test-key",
    fetchImpl: async () => {
      throw new TypeError("Network failed for Bearer test-key.");
    },
  });
  await assert.rejects(networkFailure.analyze(input), (error) => {
    assert.match(error.diagnostic.message, /Network failed/);
    assert.doesNotMatch(error.diagnostic.message, /test-key/);
    assert.match(error.diagnostic.message, /\[REDACTED\]/);
    return true;
  });

  const unconfigured = createVisionProvider("real", { apiKey: "" });
  await assert.rejects(unconfigured.analyze(input), /OPENAI_API_KEY is required/i);
});

test("OpenAI provider timeout becomes PENDING and preserves the uploaded capture", async (context) => {
  const storage = await createDatabase();
  await seedOrders(storage, await loadSeedOrders());
  let behavior = "http-error";
  let requestAborted = false;
  const loggedErrors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => loggedErrors.push(args);
  context.after(() => {
    console.error = originalConsoleError;
  });
  const vision = createVisionProvider("real", {
    apiKey: "test-key",
    fetchImpl: (_url, { signal }) => {
      if (behavior === "http-error") {
        return Promise.resolve({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({
            error: { message: "Invalid credential sk-test-secret; Bearer test-key." },
          }),
        });
      }
      return new Promise((_, reject) => {
        const onAbort = () => {
          requestAborted = true;
          reject(signal.reason);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      });
    },
  });
  const app = createApp({ storage, vision, visionTimeoutMs: 30 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await storage.close();
  });

  async function submit() {
    const form = new FormData();
    form.set("unitId", "UNIT-0008");
    form.set("image", new Blob([image], { type: "image/png" }), "open-box.png");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analyze`, {
      method: "POST",
      headers: { "x-org-id": "org_demo_alpha" },
      body: form,
    });
    return { response, inspection: await response.json() };
  }

  async function assertCapturePreserved(inspection) {
    assert.equal(inspection.modelProvider, "openai");
    assert.equal(inspection.modelStatus, "PENDING");
    assert.equal(inspection.finalDecision, "REVIEW");
    assert.ok(inspection.evidence.some((item) => item === `Uploaded image SHA-256: ${createHash("sha256").update(image).digest("hex")}`));
    const captureResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/inspections/${inspection.id}/capture`,
      { headers: { "x-org-id": "org_demo_alpha" } },
    );
    assert.equal(captureResponse.status, 200);
    assert.deepEqual(Buffer.from(await captureResponse.arrayBuffer()), image);
  }

  const apiFailure = await submit();
  assert.equal(apiFailure.response.status, 201);
  await assertCapturePreserved(apiFailure.inspection);
  const apiFailureLog = loggedErrors.find((args) => args[0] === "OpenAI vision analysis failed:"
    && args[1]?.status === 401);
  assert.ok(apiFailureLog);
  assert.match(apiFailureLog[1].message, /response text suppressed/i);
  assert.doesNotMatch(JSON.stringify(apiFailureLog), /test-key|sk-test-secret/);

  behavior = "timeout";
  const timeout = await submit();
  assert.equal(timeout.response.status, 201);
  assert.match(timeout.inspection.reason, /timed out after 30 ms/i);
  assert.equal(requestAborted, true);
  await assertCapturePreserved(timeout.inspection);
  assert.ok(loggedErrors.some((args) => args[0] === "OpenAI vision analysis failed:"
    && /timed out after 30 ms/i.test(args[1]?.message)));
});
