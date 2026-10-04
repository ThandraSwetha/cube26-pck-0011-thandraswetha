import path from "node:path";
import express from "express";
import { applicationDirectory, createApplication } from "./application.js";

const port = Number(process.env.PORT || 4000);
const { app, storage, vision } = await createApplication();

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
