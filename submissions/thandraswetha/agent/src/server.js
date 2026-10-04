import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { createApp } from "./api/app.js";
import { loadSeedOrders, seedOrders } from "./data/seed-orders.js";
import { createDatabase } from "./storage/database.js";
import { createVisionProvider } from "./vision/provider-factory.js";

const applicationDirectory = fileURLToPath(new URL("..", import.meta.url));
const dotenvResult = dotenv.config({
  path: path.join(applicationDirectory, ".env"),
  override: true,
});
const openAIKeySource = dotenvResult.parsed?.OPENAI_API_KEY !== undefined
  ? "project .env (overrides inherited process environment)"
  : "project .env key not set";
const geminiKeySource = dotenvResult.parsed?.GEMINI_API_KEY !== undefined
  ? "project .env (overrides inherited process environment)"
  : "project .env key not set";
const databaseDirectory = process.env.DATABASE_DIR
  ? path.resolve(applicationDirectory, process.env.DATABASE_DIR)
  : path.join(applicationDirectory, "var", "pack-manager-db");
const port = Number(process.env.PORT || 4000);
const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 8);
const visionTimeoutMs = Number(process.env.VISION_TIMEOUT_MS ?? 30000);
if (!Number.isSafeInteger(visionTimeoutMs) || visionTimeoutMs <= 0) {
  throw new Error("VISION_TIMEOUT_MS must be a positive integer.");
}
const vision = createVisionProvider(process.env.VISION_PROVIDER || "mock", {
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_VISION_MODEL,
  baseUrl: process.env.OPENAI_BASE_URL,
  apiKeySource: openAIKeySource,
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_VISION_MODEL,
  geminiApiKeySource: geminiKeySource,
});

const storage = await createDatabase(databaseDirectory);
await seedOrders(storage, await loadSeedOrders());
const app = createApp({
  storage,
  vision,
  maxUploadMb,
  visionTimeoutMs,
});

const builtFrontend = path.join(applicationDirectory, "web", "dist");
app.use(express.static(builtFrontend));
app.get("*path", (_request, response) => response.sendFile(path.join(builtFrontend, "index.html")));

const server = app.listen(port, "0.0.0.0", () => {

  console.log(`Pack Manager API listening on http://127.0.0.1:${port}`);
  console.log(vision.provider === "mock"
    ? "Vision provider: MOCK (demo scenarios only; no real image inference or accuracy claim)"
    : `Vision provider: ${vision.provider.toUpperCase()}`);
  if (vision.provider === "openai") {
    console.log("OpenAI vision configuration (safe diagnostics):", vision.configurationDiagnostics);
  } else if (vision.provider === "gemini") {
    console.log("Gemini vision configuration (safe diagnostics):", vision.configurationDiagnostics);
  }
});

async function shutdown() {
  server.close(async () => {
    await storage.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
