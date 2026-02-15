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
          context: contextPayload,
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
