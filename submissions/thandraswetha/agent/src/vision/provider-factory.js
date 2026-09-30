import { createVisionService } from "./mock-vision-service.js";

function createVisionProvider(provider = "mock") {
  if (provider === "mock") return createVisionService();
  if (provider === "real") throw new Error("Real vision provider is not configured.");
  throw new Error(`Unknown vision provider '${provider}'.`);
}

export { createVisionProvider };