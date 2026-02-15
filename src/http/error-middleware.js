import { anthropicError, json } from "./response.js";

export function createErrorMiddleware() {
  return async function errorMiddleware(context, next) {
    const { req, res, logger, requestId } = context;

    try {
      await next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.server("http_handler_error", {
        requestId,
        method: req.method || "",
        url: req.url || "",
        message
      });
      if (!res.headersSent) {
        json(res, 500, anthropicError("api_error", message));
      } else {
        res.end();
      }
    }
  };
}
