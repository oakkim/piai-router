import { createRequestId } from "./request-id.js";

export function attachRequestContext(req, res) {
  const startedAt = Date.now();
  const requestId =
    typeof req?.piaiRequestId === "string" && req.piaiRequestId
      ? req.piaiRequestId
      : createRequestId("http");

  req.piaiRequestId = requestId;
  res.setHeader("x-request-id", requestId);

  return {
    requestId,
    startedAt,
    method: req.method || "",
    url: req.url || ""
  };
}
