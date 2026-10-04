import { MAX_EVIDENCE_ITEMS, validateVisionResult } from "./vision-schema.js";

const DEFAULT_MODEL = "gpt-4.1-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeDiagnosticText(value, apiKey) {
  let text = typeof value === "string" ? value : String(value ?? "Unknown error");
  if (apiKey) text = text.split(apiKey).join("[REDACTED]");
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .slice(0, 1000);
}

function createProviderError(message, { status, code, detail } = {}, apiKey) {
  const error = new Error(safeDiagnosticText(message, apiKey));
  const diagnostic = {
    message: safeDiagnosticText(detail || message, apiKey),
  };
  if (Number.isInteger(status)) diagnostic.status = status;
  if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(code)) {
    diagnostic.code = code;
  }
  error.diagnostic = diagnostic;
  if (diagnostic.code) error.code = diagnostic.code;
  return error;
}

async function readErrorDetail(response) {
  try {
    const body = await response.text();
    if (!body) return undefined;
    try {
      const payload = JSON.parse(body);
      if (typeof payload?.error?.message === "string") return payload.error.message;
    } catch {
      return undefined;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["imageQuality", "detectedItems", "uncertainItems", "evidence"],
  properties: {
    imageQuality: { type: "string", enum: ["GOOD", "POOR"] },
    detectedItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sku", "name", "quantity", "confidence", "evidence"],
        properties: {
          sku: { type: "string" },
          name: { type: "string" },
          quantity: { type: "integer" },
          confidence: { type: "number" },
          evidence: { type: "string" },
        },
      },
    },
    uncertainItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["possibleSkus", "reason"],
        properties: {
          possibleSkus: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
        },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
  },
};

function responseText(payload) {
  if (Array.isArray(payload?.output)) {
    for (const output of payload.output) {
      if (output?.type !== "message" || !Array.isArray(output.content)) continue;
      if (output.content.some((content) => content?.type === "refusal")) {
        throw new Error("OpenAI vision response was refused.");
      }
    }
  }
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (!Array.isArray(payload?.output)) return null;
  const textParts = [];
  for (const output of payload.output) {
    if (output?.type !== "message" || !Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (content?.type === "refusal") {
        throw new Error("OpenAI vision response was refused.");
      }
      if (content?.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }
  return textParts.length > 0 ? textParts.join("") : null;
}

function parseOpenAIVisionResponse(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenAI vision API returned an invalid response.");
  }
  if (payload.status && payload.status !== "completed") {
    throw new Error("OpenAI vision API response did not complete.");
  }

  const text = responseText(payload);
  if (!text) throw new Error("OpenAI vision response did not contain structured output.");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI vision response did not contain valid JSON.");
  }

  const result = validateVisionResult(parsed);
  const trace = ["OpenAI Responses API vision analysis completed."];
  if (typeof payload.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.id)) {
    trace.push(`OpenAI Responses API response ID: ${payload.id}`);
  }
  if (result.evidence.length + trace.length > MAX_EVIDENCE_ITEMS) {
    throw new Error("OpenAI vision response exceeded the evidence limit.");
  }
  return { ...result, evidence: [...result.evidence, ...trace] };
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid HTTPS URL.");
  }
  const isLocalHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if ((url.protocol !== "https:" && !isLocalHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error("OPENAI_BASE_URL must use HTTPS and must not contain credentials or query parameters.");
  }
  return url.toString().replace(/\/+$/, "");
}

function createOpenAIVisionService({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_VISION_MODEL || DEFAULT_MODEL,
  baseUrl = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
  apiKeySource = "unknown",
  fetchImpl = globalThis.fetch,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const endpoint = `${normalizedBaseUrl}/responses`;
  const key = typeof apiKey === "string" ? apiKey : "";
  const configurationDiagnostics = Object.freeze({
    apiKeyPresent: key.length > 0,
    apiKeyLength: key.length,
    apiKeyStartsWithSk: key.startsWith("sk-"),
    apiKeyHasLeadingOrTrailingWhitespace: key !== key.trim(),
    apiKeyContainsQuotes: /["']/.test(key),
    apiKeyContainsLineBreak: /[\r\n]/.test(key),
    apiKeyContainsOtherControlCharacters: /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(key),
    apiKeySource,
    baseUrl: normalizedBaseUrl,
    endpoint,
    model,
  });

  return {
    provider: "openai",
    configurationDiagnostics,
    analyze: async ({ image, mimeType, expectedItems }, { signal } = {}) => {
      if (typeof apiKey !== "string" || !apiKey.trim()) {
        throw new Error("OPENAI_API_KEY is required to use the OpenAI vision provider.");
      }
      if (typeof model !== "string" || !model.trim()) {
        throw new Error("OPENAI_VISION_MODEL must be a non-empty model name.");
      }
      if (typeof fetchImpl !== "function") {
        throw new Error("This Node.js runtime does not provide fetch for the OpenAI vision provider.");
      }
      if (!Buffer.isBuffer(image) || !SUPPORTED_IMAGE_TYPES.has(mimeType)) {
        throw new Error("OpenAI vision provider received an unsupported image.");
      }
      if (!Array.isArray(expectedItems) || expectedItems.length === 0) {
        throw new Error("OpenAI vision provider requires expected order items.");
      }

      const catalog = expectedItems.map(({ sku, name, quantity }) => ({ sku, name, quantity }));
      const imageUrl = `data:${mimeType};base64,${image.toString("base64")}`;
      const requestBody = {
        model,
        input: [
          {
            role: "system",
            content: "Analyze only the visible package contents and image quality. Return detected item identities, visible quantities, uncertainty, and concise visual evidence. Use an expected SKU only when the image supports that identity. For a clearly visible item that is not in the expected catalog, use a descriptive UNEXPECTED:<label> SKU. Put ambiguous identities in uncertainItems. Do not compare the detections with the order, evaluate whether packing is correct, or recommend or choose any action or decision.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Expected catalog for visual identification only:\n${JSON.stringify(catalog)}`,
              },
              { type: "input_image", image_url: imageUrl, detail: "auto" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "pack_image_analysis",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      };

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal,
        });
      } catch (error) {
        throw createProviderError("OpenAI vision request failed.", {
          code: error?.code,
          detail: error?.message || error,
        }, apiKey);
      }
      if (!response.ok) {
        throw createProviderError(`OpenAI vision API returned HTTP ${response.status}.`, {
          status: response.status,
          detail: response.status === 401 ? undefined : await readErrorDetail(response),
        }, apiKey);
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw createProviderError("OpenAI vision API returned invalid JSON.", {
          detail: error?.message,
        }, apiKey);
      }
      try {
        return parseOpenAIVisionResponse(payload);
      } catch (error) {
        throw createProviderError("OpenAI vision response could not be processed.", {
          detail: error?.message,
        }, apiKey);
      }
    },
  };
}

export { createOpenAIVisionService, parseOpenAIVisionResponse };
