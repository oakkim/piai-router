import { listAdvertisedModels } from "../../model-mapper.js";
import { json } from "../response.js";

export function createModelsHandler({ config, logger }) {
  return async function handleModels(context) {
    const { res, requestId } = context;
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

    logger?.server("models_list", { requestId, total: models.length });
  };
}
