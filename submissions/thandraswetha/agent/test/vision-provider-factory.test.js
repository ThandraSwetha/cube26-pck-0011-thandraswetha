import test from "node:test";
import assert from "node:assert/strict";
import { createVisionProvider } from "../src/vision/provider-factory.js";

test("mock provider selection returns the existing vision service", () => {
  const provider = createVisionProvider("mock");

  assert.equal(provider.provider, "mock");
  assert.equal(typeof provider.analyze, "function");
});

test("real provider selection reports that it is not configured", () => {
  assert.throws(
    () => createVisionProvider("real"),
    { message: "Real vision provider is not configured." },
  );
});

test("unknown provider selection fails clearly", () => {
  assert.throws(
    () => createVisionProvider("vision-x"),
    { message: "Unknown vision provider 'vision-x'." },
  );
});