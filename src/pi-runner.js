import { completeSimple, streamSimple } from "@mariozechner/pi-ai";
import { resolveOAuthApiKey } from "./oauth-auth.js";

function buildModel(config, modelId) {
  return {
    id: modelId,
    name: modelId,
    api: config.upstream.api,
    provider: config.upstream.provider,
    baseUrl: config.upstream.baseUrl,
    reasoning: Boolean(config.upstream.reasoning),
    input: Array.isArray(config.upstream.input) ? config.upstream.input : ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.upstream.contextWindow,
    maxTokens: config.upstream.maxTokens,
    headers: config.upstream.headers,
    compat: config.upstream.compat
  };
}

function supportsTemperature(config) {
  const api = String(config?.upstream?.api || "").trim().toLowerCase();
  if (!api) {
    return true;
  }
  if (api === "openai-codex-responses") {
    return false;
  }
  return true;
}

function buildRunOptions(params) {
  const body = params.requestBody || {};
  const route = params.modelRoute || {};
  const opts = {
    apiKey: params.apiKey,
    headers: params.config.upstream.headers
  };

  if (typeof body.max_tokens === "number" && body.max_tokens > 0) {
    opts.maxTokens = body.max_tokens;
  }
  if (Number.isFinite(body.temperature) && supportsTemperature(params.config)) {
    opts.temperature = body.temperature;
  }

  const mappedReasoning =
    route && route.hasReasoningOverride === true && typeof route.reasoning === "string"
      ? route.reasoning
      : "";
  if (mappedReasoning) {
    opts.reasoning = mappedReasoning;
    return opts;
  }

  // Explicit "none" in modelMap reasoning override disables reasoning on this request.
  if (route && route.hasReasoningOverride === true && !mappedReasoning) {
    return opts;
  }

  if (params.config.upstream.reasoning === true) {
    const sourceEffort = typeof route?.sourceEffort === "string" ? route.sourceEffort : "";
    const effortMap = {
      low: "minimal",
      medium: "medium",
      high: "high",
      max: "xhigh"
    };
    opts.reasoning = effortMap[sourceEffort] || "minimal";
  }
  return opts;
}

export function createPiRunner(config) {
  const resolveApiKey = async (explicitApiKey) => {
    if (config.upstream.authMode === "oauth") {
      return resolveOAuthApiKey(config);
    }
    return explicitApiKey;
  };

  return {
    async complete(params) {
      const model = buildModel(config, params.modelId);
      const apiKey = await resolveApiKey(params.apiKey);
      const options = buildRunOptions({
        config,
        modelRoute: params.modelRoute,
        requestBody: params.requestBody,
        apiKey
      });
      return completeSimple(model, params.context, options);
    },

    async stream(params) {
      const model = buildModel(config, params.modelId);
      const apiKey = await resolveApiKey(params.apiKey);
      const options = buildRunOptions({
        config,
        modelRoute: params.modelRoute,
        requestBody: params.requestBody,
        apiKey
      });
      return streamSimple(model, params.context, options);
    }
  };
}

export const _internal = {
  buildModel,
  buildRunOptions,
  supportsTemperature
};
