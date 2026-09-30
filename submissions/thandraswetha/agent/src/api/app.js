import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import multer from "multer";
import { fileTypeFromBuffer } from "file-type";
import { decidePacking } from "../domain/decision-engine.js";
import { getCapture, getInspection, listInspections, saveInspection } from "../storage/inspection-store.js";
import { validateVisionResult } from "../vision/vision-schema.js";

const ALLOWED_ORGS = new Set(["org_demo_alpha", "org_demo_bravo"]);
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SCENARIOS = new Set(["match", "missing_item", "wrong_quantity", "extra_item", "uncertain", "model_failure"]);
const VALID_IMAGE_QUALITIES = new Set(["GOOD", "POOR"]);

function withTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Vision provider timeout");
      error.code = "VISION_TIMEOUT";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function preserveValidVisionField(result, field, imageQuality) {
  if (!Array.isArray(result?.[field])) return [];
  const candidate = {
    imageQuality: imageQuality || "GOOD",
    detectedItems: field === "detectedItems" ? result[field] : [],
    uncertainItems: field === "uncertainItems" ? result[field] : [],
    evidence: [],
  };
  try {
    return validateVisionResult(candidate)[field];
  } catch {
    return [];
  }
}

function pendingVisionResult(result, expectedItems, failureReason) {
  const imageQuality = VALID_IMAGE_QUALITIES.has(result?.imageQuality) ? result.imageQuality : null;
  const returnedUncertainty = preserveValidVisionField(result, "uncertainItems", imageQuality);
  return {
    imageQuality,
    detectedItems: preserveValidVisionField(result, "detectedItems", imageQuality),
    uncertainItems: returnedUncertainty.length > 0
      ? returnedUncertainty
      : expectedItems.map((item) => ({ possibleSkus: [item.sku], reason: failureReason })),
    evidence: Array.isArray(result?.evidence) ? result.evidence : [],
  };
}

function safeJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function createApp({ storage, vision, maxUploadMb = 8, visionTimeoutMs = 15000 }) {
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 } });

  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_request, response) => response.json({ status: "ok" }));

  app.use("/api", (request, response, next) => {
    const orgId = request.get("x-org-id");
    if (!ALLOWED_ORGS.has(orgId)) return response.status(400).json({ error: "Select a supported organization." });
    request.orgId = orgId;
    return next();
  });

  app.get("/api/orders", async (request, response, next) => {
    try {
      const result = await storage.withTenant(request.orgId, ({ query }) => query(
        "SELECT org_id, unit_id, order_id, channel, expected_items FROM orders ORDER BY unit_id",
      ));
      response.json(result.rows.map((row) => ({
        orgId: row.org_id,
        unitId: row.unit_id,
        orderId: row.order_id,
        channel: row.channel,
        expectedItems: safeJson(row.expected_items),
      })));
    } catch (error) { next(error); }
  });

  app.get("/api/orders/:unitId", async (request, response, next) => {
    try {
      const result = await storage.withTenant(request.orgId, ({ query }) => query(
        "SELECT org_id, unit_id, order_id, channel, expected_items FROM orders WHERE unit_id = $1",
        [request.params.unitId],
      ));
      const row = result.rows[0];
      if (!row) return response.status(404).json({ error: "Order not found for this organization." });
      return response.json({
        orgId: row.org_id,
        unitId: row.unit_id,
        orderId: row.order_id,
        channel: row.channel,
        expectedItems: safeJson(row.expected_items),
      });
    } catch (error) { return next(error); }
  });

  app.get("/api/inspections", async (request, response, next) => {
    try { response.json(await listInspections(storage, request.orgId)); } catch (error) { next(error); }
  });

  app.get("/api/inspections/:id/capture", async (request, response, next) => {
    try {
      const capture = await getCapture(storage, request.orgId, request.params.id);
      if (!capture) return response.status(404).json({ error: "Capture not found for this organization." });
      return response.type(capture.mime_type).send(Buffer.from(capture.image_base64, "base64"));
    } catch (error) { return next(error); }
  });

  app.get("/api/inspections/:id", async (request, response, next) => {
    try {
      const inspection = await getInspection(storage, request.orgId, request.params.id);
      if (!inspection) return response.status(404).json({ error: "Inspection not found for this organization." });
      return response.json(inspection);
    } catch (error) { return next(error); }
  });

  async function analyze(request, response, next) {
    try {
      const { unitId } = request.body ?? {};
      const scenario = request.body?.scenario ?? "match";
      if (typeof unitId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(unitId)) {
        return response.status(400).json({ error: "A valid unit ID is required." });
      }
      if (vision.provider === "mock" && !SCENARIOS.has(scenario)) {
        return response.status(400).json({ error: "Unknown local demonstration scenario." });
      }
      if (!request.file) return response.status(400).json({ error: "Upload an open-box image before analysis." });

      const detectedType = await fileTypeFromBuffer(request.file.buffer);
      if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType.mime)) {
        return response.status(415).json({ error: "Use a valid JPG, PNG, or WEBP image." });
      }

      const orderResult = await storage.withTenant(request.orgId, ({ query }) => query(
        "SELECT unit_id, order_id, expected_items FROM orders WHERE unit_id = $1",
        [unitId],
      ));
      const order = orderResult.rows[0];
      if (!order) return response.status(404).json({ error: "Order not found for this organization." });
      const expectedItems = safeJson(order.expected_items);
      if (!Array.isArray(expectedItems) || expectedItems.length === 0) {
        return response.status(422).json({ error: "This order has no expected item lines." });
      }

      const inspectionId = randomUUID();
      const createdAt = new Date().toISOString();
      const hash = createHash("sha256").update(request.file.buffer).digest("hex");
      let modelStatus = "COMPLETED";
      let visionResult;
      let modelFailureReason;
      let providerResponse;
      try {
        const visionInput = { image: request.file.buffer, expectedItems };
        if (vision.provider === "mock") visionInput.scenario = scenario;
        providerResponse = await withTimeout(
          Promise.resolve().then(() => vision.analyze(visionInput)),
          visionTimeoutMs,
        );
        try {
          visionResult = validateVisionResult(providerResponse);
        } catch {
          modelStatus = "PENDING";
          modelFailureReason = "Vision analysis returned an invalid response. The uploaded capture was saved for review.";
        }
      } catch (error) {
        modelStatus = "PENDING";
        modelFailureReason = error.code === "VISION_TIMEOUT"
          ? `Vision analysis timed out after ${visionTimeoutMs} ms. The uploaded capture was saved for review.`
          : "Vision analysis failed. The uploaded capture was saved for review.";
      }
      if (modelStatus === "PENDING") {
        visionResult = pendingVisionResult(providerResponse, expectedItems, modelFailureReason);
      }

      const decision = decidePacking({
        expectedItems,
        detectedItems: modelStatus === "PENDING" ? [] : visionResult.detectedItems,
        imageQuality: visionResult.imageQuality,
        uncertainItems: visionResult.uncertainItems,
      });
      const evidence = [
        `Uploaded image SHA-256: ${hash}`,
        ...visionResult.evidence,
        ...visionResult.detectedItems.map((item) => item.evidence),
        ...visionResult.uncertainItems.map((item) => item.reason),
      ];
      if (modelFailureReason) evidence.push(modelFailureReason);
      const inspection = {
        id: inspectionId,
        orgId: request.orgId,
        unitId: order.unit_id,
        orderId: order.order_id,
        createdAt,
        modelStatus,
        modelProvider: vision.provider,
        imageQuality: visionResult.imageQuality,
        uncertainItems: visionResult.uncertainItems,
        expectedItems,
        detectedItems: visionResult.detectedItems,
        checks: decision.checks,
        finalDecision: decision.finalDecision,
        reason: modelFailureReason ? `${decision.reason} ${modelFailureReason}` : decision.reason,
        evidence,
      };
      await saveInspection(storage, inspection, {
        id: randomUUID(),
        sha256: hash,
        name: path.basename(request.file.originalname).slice(0, 200),
        mimeType: detectedType.mime,
        base64: request.file.buffer.toString("base64"),
      });
      return response.status(201).json(inspection);
    } catch (error) { return next(error); }
  }

  app.post("/api/analyze", upload.single("image"), analyze);
  app.post("/api/inspections", upload.single("image"), analyze);

  app.use((error, _request, response, _next) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({ error: `Image exceeds the ${maxUploadMb} MB upload limit.` });
    }
    if (error instanceof multer.MulterError) return response.status(400).json({ error: "The uploaded image could not be accepted." });
    console.error("Pack Manager request failed:", error.message);
    return response.status(500).json({ error: "The request could not be completed. Check the service and try again." });
  });

  return app;
}

export { createApp };