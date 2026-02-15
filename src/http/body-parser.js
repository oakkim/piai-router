import { GatewayHttpError } from "./http-errors.js";

function toBufferChunk(chunk) {
  return typeof chunk === "string" ? Buffer.from(chunk) : chunk;
}

export async function readJsonBody(req, maxBodyBytes = 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = toBufferChunk(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBodyBytes) {
      throw new GatewayHttpError(
        413,
        "invalid_request_error",
        "Request body too large",
        { internalMessage: `Request body exceeded ${maxBodyBytes} bytes.` }
      );
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new GatewayHttpError(400, "invalid_request_error", "Invalid JSON body");
  }
}
