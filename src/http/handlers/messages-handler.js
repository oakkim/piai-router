import {
  anthropicRequestToPiContext,
  convertPiEventToAnthropicSseRecords,
  createAnthropicStreamState,
  piAssistantToAnthropicMessage
} from "../../anthropic-bridge.js";
import { resolveModelRoute } from "../../model-mapper.js";
import { readJsonBody } from "../body-parser.js";
import { GatewayHttpError } from "../http-errors.js";
import { json } from "../response.js";
import { getUpstreamApiKey } from "../upstream-auth.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY_FRAGMENTS = [
  "authorization",
  "api-key",
  "api_key",
  "apikey",
  "x-api-key",
  "x_api_key",
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "secret",
  "password",
  "client_secret",
  "private_key",
  "ssh_key",
  "sessionid",
  "cookie"
];

function shouldRedactKey(key) {
  const normalized = String(key || "").toLowerCase();
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function sanitizeForLogging(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogging(entry, seen));
  }

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      out[key] = typeof entry === "undefined" ? entry : REDACTED_VALUE;
      continue;
    }
    out[key] = sanitizeForLogging(entry, seen);
  }
  return out;
}

function hasVisibleAssistantContent(message) {
  if (!isRecord(message)) {
    return false;
  }
  const blocks = Array.isArray(message.content) ? message.content : [];
  return blocks.some((block) => {
    if (!isRecord(block) || typeof block.type !== "string") {
      return false;
    }
    if (block.type === "text") {
      return typeof block.text === "string" && block.text.length > 0;
    }
    if (block.type === "thinking" || block.type === "reasoning") {
      if (typeof block.thinking === "string" && block.thinking.length > 0) {
        return true;
      }
      return typeof block.text === "string" && block.text.length > 0;
    }
    if (block.type === "toolCall") {
      return typeof block.name === "string" && block.name.length > 0;
    }
    return false;
  });
}

function appendDelta(map, index, delta) {
  if (typeof delta !== "string" || !delta) {
    return;
  }
  const key = Number.isFinite(index) ? index : 0;
  const prev = map.get(key) || "";
  map.set(key, prev + delta);
}

function recordContentOrder(state, kind, index) {
  const key = `${kind}:${Number.isFinite(index) ? index : 0}`;
  if (state.orderKeys.has(key)) {
    return;
  }
  state.orderKeys.add(key);
  state.order.push({ kind, index: Number.isFinite(index) ? index : 0 });
}

function synthesizeContentFromStreamEvents(state) {
  const content = [];

  for (const entry of state.order) {
    if (entry.kind === "thinking") {
      const thinking = state.thinkingByIndex.get(entry.index) || "";
      if (thinking) {
        content.push({ type: "thinking", thinking });
      }
      continue;
    }
    if (entry.kind === "text") {
      const text = state.textByIndex.get(entry.index) || "";
      if (text) {
        content.push({ type: "text", text });
      }
      continue;
    }
    if (entry.kind === "toolCall") {
      const toolCall = state.toolCallByIndex.get(entry.index);
      if (!isRecord(toolCall)) {
        continue;
      }
      const name = typeof toolCall.name === "string" ? toolCall.name : "";
      if (!name) {
        continue;
      }
      const id = typeof toolCall.id === "string" && toolCall.id ? toolCall.id : `tool_${entry.index}`;
      const args = isRecord(toolCall.arguments) ? toolCall.arguments : {};
      content.push({
        type: "toolCall",
        id,
        name,
        arguments: args
      });
    }
  }

  return content;
}

async function recoverCompletionFromStream({ runner, streamArgs }) {
  const stream = await runner.stream(streamArgs);
  const recoveryState = {
    thinkingByIndex: new Map(),
    textByIndex: new Map(),
    toolCallByIndex: new Map(),
    order: [],
    orderKeys: new Set()
  };

  let finalMessage = null;
  for await (const event of stream) {
    if (!isRecord(event)) {
      continue;
    }

    const contentIndex = Number(event.contentIndex);
    if (event.type === "thinking_delta") {
      recordContentOrder(recoveryState, "thinking", contentIndex);
      appendDelta(recoveryState.thinkingByIndex, contentIndex, event.delta);
      continue;
    }
    if (event.type === "text_delta") {
      recordContentOrder(recoveryState, "text", contentIndex);
      appendDelta(recoveryState.textByIndex, contentIndex, event.delta);
      continue;
    }
    if (event.type === "toolcall_end" && isRecord(event.toolCall)) {
      const key = Number.isFinite(contentIndex) ? contentIndex : recoveryState.toolCallByIndex.size;
      recordContentOrder(recoveryState, "toolCall", key);
      recoveryState.toolCallByIndex.set(key, event.toolCall);
      continue;
    }
    if (event.type === "done" && isRecord(event.message)) {
      finalMessage = event.message;
      continue;
    }
    if (event.type === "error" && isRecord(event.error)) {
      finalMessage = event.error;
    }
  }

  if (hasVisibleAssistantContent(finalMessage)) {
    return finalMessage;
  }

  const synthesizedContent = synthesizeContentFromStreamEvents(recoveryState);
  if (synthesizedContent.length === 0) {
    return finalMessage;
  }

  const base = isRecord(finalMessage) ? finalMessage : {};
  return {
    ...base,
    content: synthesizedContent
  };
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

function shouldSuppressThinking(body) {
  const formatType = body?.output_config?.format?.type;
  if (typeof formatType !== "string") {
    return false;
  }
  return formatType.trim().toLowerCase() === "json_schema";
}

export function createMessagesHandler({ config, runner, logger }) {
  return async function handleMessages(context) {
    const { req, res, requestId } = context;
    const body = await readJsonBody(req, config.http.maxBodyBytes);

    const upstreamApiKey = getUpstreamApiKey(req, config);
    if (config?.upstream?.authMode !== "oauth" && !upstreamApiKey) {
      logger?.conversation("request_rejected", {
        requestId,
        reason: "missing_upstream_api_key"
      });
      throw new GatewayHttpError(
        500,
        "api_error",
        "No upstream API key. Set PI_API_KEY or send Authorization/x-api-key."
      );
    }

    const contextPayload = anthropicRequestToPiContext(body);
    const modelRoute = resolveModelForBody(body, config);
    const resolvedModel = modelRoute.modelId;
    const isStream = body.stream === true;
    const suppressThinking = shouldSuppressThinking(body);

    logger?.conversation("request", {
      requestId,
      stream: isStream,
      requestedModel: body?.model || "",
      resolvedModel,
      sourceEffort: modelRoute.sourceEffort,
      mappedReasoning: modelRoute.hasReasoningOverride ? modelRoute.reasoning : "",
      modelMatch: modelRoute.matchedBy,
      body: sanitizeForLogging(body)
    });

    if (!isStream) {
      try {
        const runArgs = {
          modelId: resolvedModel,
          modelRoute,
          context: contextPayload,
          requestBody: body,
          apiKey: upstreamApiKey
        };

        let completion = await runner.complete(runArgs);
        if (!hasVisibleAssistantContent(completion)) {
          logger?.conversation("response_warning", {
            requestId,
            stream: false,
            reason: "empty_completion_from_complete",
            stopReason: typeof completion?.stopReason === "string" ? completion.stopReason : "",
            errorMessage: typeof completion?.errorMessage === "string" ? completion.errorMessage : ""
          });

          const shouldRecover =
            completion?.stopReason === "error" || completion?.stopReason === "aborted" ||
            (typeof completion?.errorMessage === "string" && completion.errorMessage.trim());

          if (shouldRecover) {
            const recovered = await recoverCompletionFromStream({
              runner,
              streamArgs: runArgs
            });
            if (recovered) {
              completion = recovered;
            }
          }
        }

        if (
          !hasVisibleAssistantContent(completion) &&
          (completion?.stopReason === "error" || completion?.stopReason === "aborted")
        ) {
          const upstreamMessage =
            typeof completion?.errorMessage === "string" && completion.errorMessage.trim()
              ? completion.errorMessage.trim()
              : "Upstream returned empty response";
          throw new Error(upstreamMessage);
        }

        const responseBody = piAssistantToAnthropicMessage({
          message: completion,
          requestedModel: body.model || resolvedModel,
          resolvedModel,
          suppressThinking
        });

        json(res, 200, responseBody);
        logger?.conversation("response", {
          requestId,
          stream: false,
          stopReason: responseBody.stop_reason,
          response: sanitizeForLogging(responseBody)
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.conversation("response_error", {
          requestId,
          stream: false,
          message
        });
        throw new GatewayHttpError(502, "api_error", "Upstream request failed", {
          internalMessage: message
        });
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
        context: contextPayload,
        requestBody: body,
        apiKey: upstreamApiKey
      });
      const streamState = createAnthropicStreamState({
        model: body.model || resolvedModel,
        suppressThinking
      });

      for await (const event of stream) {
        if (event?.type === "done") {
          const responseBody = piAssistantToAnthropicMessage({
            message: event.message,
            requestedModel: body.model || resolvedModel,
            resolvedModel,
            suppressThinking
          });
          logger?.conversation("response", {
            requestId,
            stream: true,
            stopReason: responseBody.stop_reason,
            response: sanitizeForLogging(responseBody)
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

        const records = convertPiEventToAnthropicSseRecords(event, streamState);
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
            message: "Upstream stream failed"
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
  };
}
