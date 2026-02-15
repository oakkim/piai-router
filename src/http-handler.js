import {
  anthropicRequestToPiContext,
  convertPiEventToAnthropicSseRecords,
  createAnthropicStreamState,
  estimateInputTokensApprox,
  piAssistantToAnthropicMessage
} from "./anthropic-bridge.js";
import { listAdvertisedModels, resolveModelRoute } from "./model-mapper.js";

function createRequestId(prefix = "req") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestId(req) {
  if (typeof req?.piaiRequestId === "string" && req.piaiRequestId) {
    return req.piaiRequestId;
  }
  return createRequestId("msg");
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function anthropicError(type, message) {
  return {
    type: "error",
    error: {
      type,
      message
    }
  };
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0] || "";
  }
  return value || "";
}

function normalizePathname(url) {
  const raw = typeof url === "string" ? url : "";
  const pathOnly = raw.split("?", 1)[0] || "/";
  if (pathOnly.length > 1) {
    return pathOnly.replace(/\/+$/, "");
  }
  return pathOnly;
}

function extractApiToken(req) {
  const xApiKey = String(getHeader(req, "x-api-key") || "").trim();
  if (xApiKey) {
    return xApiKey;
  }
  const auth = String(getHeader(req, "authorization") || "").trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return "";
}

function validateGatewayApiKey(req, config) {
  const required = String(config.gatewayApiKey || "").trim();
  if (!required) {
    return true;
  }
  const incoming = extractApiToken(req);
  return incoming === required;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function resolveModelForBody(body, config) {
  return resolveModelRoute({
    requestedModel: body?.model,
    provider: config.provider || config.upstream.provider,
    platform: config.platform,
    fallbackModel: config.upstream.defaultModel,
    modelMap: config.modelMap,
    requestBody: body
  });
}

function getUpstreamApiKey(req, config) {
  if (config?.upstream?.authMode === "oauth") {
    return "";
  }
  return config.upstream.apiKey || extractApiToken(req);
}

async function handleCountTokens(req, res, logger) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, anthropicError("invalid_request_error", "Invalid JSON body"));
    logger?.server("count_tokens_invalid_json", { requestId: getRequestId(req) });
    return;
  }
  const inputTokens = estimateInputTokensApprox(body);
  json(res, 200, { input_tokens: inputTokens });
  logger?.conversation("count_tokens", {
    requestId: getRequestId(req),
    model: typeof body?.model === "string" ? body.model : "",
    inputTokens
  });
}

function handleModels(req, res, config, logger) {
  const models = listAdvertisedModels({
    provider: config.provider || config.upstream.provider,
    platform: config.platform,
    fallbackModel: config.upstream.defaultModel,
    modelMap: config.modelMap
  });
  json(res, 200, {
    object: "list",
    data: models.map((id) => ({
      id,
      type: "model",
      display_name: id,
      created_at: "1970-01-01T00:00:00Z"
    }))
  });
  logger?.server("models_list", { requestId: getRequestId(req), total: models.length });
}

async function handleMessages(req, res, config, runner, logger) {
  const requestId = getRequestId(req);
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, 400, anthropicError("invalid_request_error", "Invalid JSON body"));
    logger?.conversation("request_invalid_json", { requestId });
    return;
  }

  const upstreamApiKey = getUpstreamApiKey(req, config);
  if (config?.upstream?.authMode !== "oauth" && !upstreamApiKey) {
    json(
      res,
      500,
      anthropicError("api_error", "No upstream API key. Set PI_API_KEY or send Authorization/x-api-key.")
    );
    logger?.conversation("request_rejected", {
      requestId,
      reason: "missing_upstream_api_key"
    });
    return;
  }

  const context = anthropicRequestToPiContext(body);
  const modelRoute = resolveModelForBody(body, config);
  const resolvedModel = modelRoute.modelId;
  const isStream = body.stream === true;

  logger?.conversation("request", {
    requestId,
    stream: isStream,
    requestedModel: body?.model || "",
    resolvedModel,
    sourceEffort: modelRoute.sourceEffort,
    mappedReasoning: modelRoute.hasReasoningOverride ? modelRoute.reasoning : "",
    modelMatch: modelRoute.matchedBy,
    body
  });

  if (!isStream) {
    try {
      const completion = await runner.complete({
        modelId: resolvedModel,
        modelRoute,
        context,
        requestBody: body,
        apiKey: upstreamApiKey
      });
      const responseBody = piAssistantToAnthropicMessage({
        message: completion,
        requestedModel: body.model || resolvedModel,
        resolvedModel
      });
      json(res, 200, responseBody);
      logger?.conversation("response", {
        requestId,
        stream: false,
        stopReason: responseBody.stop_reason,
        response: responseBody
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 502, anthropicError("api_error", message));
      logger?.conversation("response_error", {
        requestId,
        stream: false,
        message
      });
      return;
    }
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });

  const writeRecord = (record) => {
    res.write(`event: ${record.event}\n`);
    res.write(`data: ${JSON.stringify(record.data)}\n\n`);
  };

  try {
    const stream = await runner.stream({
      modelId: resolvedModel,
      modelRoute,
      context,
      requestBody: body,
      apiKey: upstreamApiKey
    });
    const state = createAnthropicStreamState({
      model: body.model || resolvedModel
    });

    for await (const event of stream) {
      if (event?.type === "done") {
        const responseBody = piAssistantToAnthropicMessage({
          message: event.message,
          requestedModel: body.model || resolvedModel,
          resolvedModel
        });
        logger?.conversation("response", {
          requestId,
          stream: true,
          stopReason: responseBody.stop_reason,
          response: responseBody
        });
      } else if (event?.type === "error") {
        logger?.conversation("response_error", {
          requestId,
          stream: true,
          message:
            typeof event?.error?.errorMessage === "string"
              ? event.error.errorMessage
              : "stream error"
        });
      }
      const records = convertPiEventToAnthropicSseRecords(event, state);
      for (const record of records) {
        writeRecord(record);
      }
    }
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeRecord({
      event: "error",
      data: {
        type: "error",
        error: {
          type: "api_error",
          message
        }
      }
    });
    logger?.conversation("response_error", {
      requestId,
      stream: true,
      message
    });
    res.end();
  }
}

export function createGatewayHandler(params) {
  const config = params.config;
  const runner = params.runner;
  const logger = params.logger;

  return async function gatewayHandler(req, res) {
    const pathname = normalizePathname(req.url);

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization,x-api-key,anthropic-version"
      });
      res.end();
      return;
    }

    if (!validateGatewayApiKey(req, config)) {
      json(res, 401, anthropicError("authentication_error", "Invalid API key"));
      logger?.server("auth_failed", {
        requestId: getRequestId(req),
        method: req.method,
        url: req.url
      });
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && pathname === "/v1/models") {
      handleModels(req, res, config, logger);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages/count_tokens") {
      await handleCountTokens(req, res, logger);
      return;
    }

    if (req.method === "POST" && pathname === "/v1/messages") {
      await handleMessages(req, res, config, runner, logger);
      return;
    }

    json(res, 404, anthropicError("not_found_error", "Not found"));
    logger?.server("route_not_found", {
      requestId: getRequestId(req),
      method: req.method,
      url: req.url
    });
  };
}

export const _internal = {
  readJsonBody,
  resolveModelForBody,
  extractApiToken,
  validateGatewayApiKey,
  normalizePathname
};
