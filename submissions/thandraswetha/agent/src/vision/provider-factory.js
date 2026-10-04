import { createVisionService } from "./mock-vision-service.js";
import { createOpenAIVisionService } from "./openai-vision-service.js";
import { createGeminiVisionService } from "./gemini-vision-service.js";

function createVisionProvider(provider = "mock", options = {}) {
  if (provider === "mock") return createVisionService();
  if (provider === "real") return createOpenAIVisionService(options);
  if (provider === "gemini") {
    return createGeminiVisionService({
      apiKey: options.geminiApiKey,
      model: options.geminiModel,
      apiKeySource: options.geminiApiKeySource,
      fetchImpl: options.fetchImpl,
    });
  }
  throw new Error(`Unknown vision provider '${provider}'.`);
}

export { createVisionProvider };