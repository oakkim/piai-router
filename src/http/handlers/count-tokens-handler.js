import { estimateInputTokensApprox } from "../../anthropic-bridge.js";
import { readJsonBody } from "../body-parser.js";
import { json } from "../response.js";

export function createCountTokensHandler({ config, logger }) {
  return async function handleCountTokens(context) {
    const { req, res, requestId } = context;
    const body = await readJsonBody(req, config.http.maxBodyBytes);
    const inputTokens = estimateInputTokensApprox(body);

    json(res, 200, { input_tokens: inputTokens });
    logger?.conversation("count_tokens", {
      requestId,
      model: typeof body?.model === "string" ? body.model : "",
      inputTokens
    });
  };
}
