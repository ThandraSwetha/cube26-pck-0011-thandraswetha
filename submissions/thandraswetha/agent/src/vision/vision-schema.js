const VALID_QUALITY = new Set(["GOOD", "POOR"]);

function validateVisionResult(value) {
  if (!value || !VALID_QUALITY.has(value.imageQuality)) {
    throw new Error("Vision response has an invalid imageQuality value.");
  }
  if (!Array.isArray(value.detectedItems) || !Array.isArray(value.uncertainItems) || !Array.isArray(value.evidence)) {
    throw new Error("Vision response is missing a required list.");
  }

  for (const item of value.detectedItems) {
    if (typeof item.sku !== "string" || !item.sku.trim()
      || !Number.isInteger(item.quantity) || item.quantity < 1
      || typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1
      || typeof item.evidence !== "string") {
      throw new Error("Vision response contains an invalid detected item.");
    }
  }

  for (const item of value.uncertainItems) {
    if (!Array.isArray(item.possibleSkus) || typeof item.reason !== "string") {
      throw new Error("Vision response contains an invalid uncertain item.");
    }
  }

  return value;
}

export { validateVisionResult };