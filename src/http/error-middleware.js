import { isGatewayHttpError } from "./http-errors.js";
import { anthropicError, json } from "./response.js";

function toClientError(error) {
  if (isGatewayHttpError(error)) {
    return {
      statusCode: error.statusCode,
      type: error.type,
      message: error.clientMessage
    };
  }
  return {
    statusCode: 500,
    type: "api_error",
    message: "Internal server error"
  };
}

function toLogMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function createErrorMiddleware() {
  return async function errorMiddleware(context, next) {
    const { req, res, logger, requestId } = context;

    try {
      await next();
    } catch (error) {
      const clientError = toClientError(error);
      const logMessage = toLogMessage(error);
      logger?.server("http_handler_error", {
        requestId,
        method: req.method || "",
        url: req.url || "",
        statusCode: clientError.statusCode,
        type: clientError.type,
        message: logMessage
      });
      if (!res.headersSent) {
        json(res, clientError.statusCode, anthropicError(clientError.type, clientError.message));
      } else {
        res.end();
      }
    }
  };
}
