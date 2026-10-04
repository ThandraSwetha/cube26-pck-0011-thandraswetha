import test from "node:test";
import assert from "node:assert/strict";
import { createVisionProvider } from "../src/vision/provider-factory.js";

test("mock provider selection returns the existing vision service", () => {
  const provider = createVisionProvider("mock");

  assert.equal(provider.provider, "mock");
  assert.equal(typeof provider.analyze, "function");
});

test("real provider selection returns the OpenAI vision service", () => {
  const provider = createVisionProvider("real", { apiKey: "test-key" });

  assert.equal(provider.provider, "openai");
  assert.equal(typeof provider.analyze, "function");
});

test("Gemini provider selection returns the Gemini vision service", () => {
  const provider = createVisionProvider("gemini", {
    geminiApiKey: "test-gemini-key",
    geminiModel: "gemini-3.5-flash-lite",
    apiKey: "different-openai-key",
  });

  assert.equal(provider.provider, "gemini");
  assert.equal(typeof provider.analyze, "function");
  assert.equal(provider.configurationDiagnostics.model, "gemini-3.5-flash-lite");
  assert.equal(provider.configurationDiagnostics.apiKeyPresent, true);
});

test("unknown provider selection fails clearly", () => {
  assert.throws(
    () => createVisionProvider("vision-x"),
    { message: "Unknown vision provider 'vision-x'." },
  );
});