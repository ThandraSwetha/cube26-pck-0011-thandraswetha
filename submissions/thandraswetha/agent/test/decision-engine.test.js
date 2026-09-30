import test from "node:test";
import assert from "node:assert/strict";
import { decidePacking } from "../src/domain/decision-engine.js";

const expected = [
  { sku: "SKU-A", quantity: 2 },
  { sku: "SKU-B", quantity: 1 },
];

function detected(items, imageQuality = "GOOD", uncertainItems = []) {
  return decidePacking({ expectedItems: expected, detectedItems: items, imageQuality, uncertainItems });
}

test("exact detection passes all checks and seals", () => {
  const result = detected([
    { sku: "SKU-A", quantity: 2, confidence: 0.95 },
    { sku: "SKU-B", quantity: 1, confidence: 0.93 },
  ]);

  assert.equal(result.checks.presence.status, "PASS");
  assert.equal(result.checks.quantity.status, "PASS");
  assert.equal(result.checks.extra_items.status, "PASS");
  assert.equal(result.finalDecision, "SEAL");
});

test("missing item fails presence and stops packing", () => {
  const result = detected([{ sku: "SKU-A", quantity: 2, confidence: 0.95 }]);

  assert.equal(result.checks.presence.status, "FAIL");
  assert.equal(result.finalDecision, "STOP_AND_FIX");
});

test("wrong quantity fails quantity", () => {
  const result = detected([
    { sku: "SKU-A", quantity: 1, confidence: 0.95 },
    { sku: "SKU-B", quantity: 1, confidence: 0.93 },
  ]);

  assert.equal(result.checks.presence.status, "PASS");
  assert.equal(result.checks.quantity.status, "FAIL");
  assert.equal(result.finalDecision, "STOP_AND_FIX");
});

test("extra item fails the extra-items check", () => {
  const result = detected([
    { sku: "SKU-A", quantity: 2, confidence: 0.95 },
    { sku: "SKU-B", quantity: 1, confidence: 0.93 },
    { sku: "SKU-EXTRA", quantity: 1, confidence: 0.92 },
  ]);

  assert.equal(result.checks.extra_items.status, "FAIL");
  assert.equal(result.finalDecision, "STOP_AND_FIX");
});

test("unclear detection remains uncertain instead of passing", () => {
  const result = detected([{ sku: "SKU-A", quantity: 2, confidence: 0.95 }], "POOR");

  assert.equal(result.checks.presence.status, "UNCERTAIN");
  assert.equal(result.checks.quantity.status, "UNCERTAIN");
  assert.equal(result.checks.extra_items.status, "UNCERTAIN");
  assert.equal(result.finalDecision, "REVIEW");
});

test("multiple products sharing a display name remain distinct by SKU", () => {
  const result = decidePacking({
    expectedItems: [
      { sku: "SKU-RED", name: "Bottle", quantity: 1 },
      { sku: "SKU-BLUE", name: "Bottle", quantity: 1 },
    ],
    detectedItems: [
      { sku: "SKU-RED", name: "Bottle", quantity: 1, confidence: 0.95 },
      { sku: "SKU-BLUE", name: "Bottle", quantity: 1, confidence: 0.95 },
    ],
  });

  assert.equal(result.finalDecision, "SEAL");
});

test("zero expected lines cannot produce a pass", () => {
  const result = decidePacking({ expectedItems: [], detectedItems: [] });

  assert.equal(result.checks.presence.status, "UNCERTAIN");
  assert.equal(result.checks.quantity.status, "UNCERTAIN");
  assert.equal(result.checks.extra_items.status, "UNCERTAIN");
  assert.equal(result.finalDecision, "REVIEW");
});

test("duplicate detection rows for one SKU are summed", () => {
  const result = decidePacking({
    expectedItems: [{ sku: "SKU-A", quantity: 2 }],
    detectedItems: [
      { sku: "SKU-A", quantity: 1, confidence: 0.95 },
      { sku: "SKU-A", quantity: 1, confidence: 0.91 },
    ],
  });

  assert.equal(result.checks.quantity.status, "PASS");
  assert.equal(result.finalDecision, "SEAL");
});

test("model failure represented as poor-quality evidence requires review", () => {
  const result = decidePacking({ expectedItems: expected, detectedItems: [], imageQuality: "POOR" });

  assert.equal(result.finalDecision, "REVIEW");
  assert.match(result.reason, /insufficient/i);
});