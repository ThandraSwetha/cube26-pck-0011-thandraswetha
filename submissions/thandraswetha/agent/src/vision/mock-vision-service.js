function simulatedDetection(expectedItems, scenario) {
  const detectionsFor = (items) => items.map((item) => ({
    sku: item.sku,
    name: item.name,
    quantity: item.quantity,
    confidence: 0.99,
    evidence: `MOCK SCENARIO: ${item.quantity} visible unit(s) represented for ${item.name}.`,
  }));

  if (scenario === "model_failure") {
    throw new Error("Mock vision service failure scenario");
  }

  if (scenario === "uncertain") {
    return {
      imageQuality: "POOR",
      detectedItems: [],
      uncertainItems: expectedItems.map((item) => ({
        possibleSkus: [item.sku],
        reason: `MOCK SCENARIO: ${item.name} is obscured and cannot be confirmed.`,
      })),
      evidence: ["MOCK SCENARIO: image evidence is insufficient for reliable identification."],
    };
  }

  const alteredItems = expectedItems.map((item) => ({ ...item }));
  if (scenario === "missing_item" && alteredItems.length > 0) {
    alteredItems.shift();
  } else if (scenario === "wrong_quantity" && alteredItems.length > 0) {
    alteredItems[0].quantity = Math.max(0, alteredItems[0].quantity - 1);
  } else if (scenario === "extra_item") {
    alteredItems.push({ sku: "SKU-DEMO-EXTRA", name: "Unexpected demo item", quantity: 1 });
  }

  return {
    imageQuality: "GOOD",
    detectedItems: detectionsFor(alteredItems.filter((item) => item.quantity > 0)),
    uncertainItems: [],
    evidence: ["MOCK SCENARIO: detections are generated from the selected demonstration case, not inferred from pixels."],
  };
}

function createVisionService(provider = "mock") {
  if (provider !== "mock") {
    throw new Error(`Vision provider '${provider}' is not implemented. Configure 'mock' for local demonstration.`);
  }

  return {
    provider: "mock",
    analyze: async ({ expectedItems, scenario = "match" }) => simulatedDetection(expectedItems, scenario),
  };
}

export { createVisionService };