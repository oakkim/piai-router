import test from "node:test";
import assert from "node:assert/strict";
import { listAdvertisedModels, resolveMappedModel, resolveModelRoute } from "../src/model-mapper.js";

test("resolveMappedModel uses platform-specific mapping", () => {
  const model = resolveMappedModel({
    requestedModel: "claude-sonnet-4-5",
    provider: "openai-codex",
    platform: "openai-codex",
    fallbackModel: "codex-mini-latest",
    modelMap: {
      "claude-sonnet-4-5": {
        "openai-codex": "gpt-5",
        default: "gpt-5-mini"
      }
    }
  });
  assert.equal(model, "gpt-5");
});

test("resolveMappedModel falls back to default map entry", () => {
  const model = resolveMappedModel({
    requestedModel: "unknown-model",
    provider: "openai-codex",
    platform: "openai-codex",
    fallbackModel: "codex-mini-latest",
    modelMap: {
      default: {
        "openai-codex": "codex-mini-latest"
      }
    }
  });
  assert.equal(model, "codex-mini-latest");
});

test("resolveMappedModel supports prefix alias mapping for versioned model ids", () => {
  const model = resolveMappedModel({
    requestedModel: "claude-sonnet-4-5-20250929",
    provider: "openai-codex",
    platform: "openai-codex",
    fallbackModel: "codex-mini-latest",
    modelMap: {
      "claude-sonnet-4-5": "gpt-5"
    }
  });
  assert.equal(model, "gpt-5");
});

test("resolveMappedModel falls back when model family mismatches provider platform", () => {
  const model = resolveMappedModel({
    requestedModel: "claude-sonnet-4-5-20250929",
    provider: "openai-codex",
    platform: "openai-codex",
    fallbackModel: "codex-mini-latest",
    modelMap: {}
  });
  assert.equal(model, "codex-mini-latest");
});

test("resolveMappedModel supports provider-prefixed model map key", () => {
  const model = resolveMappedModel({
    requestedModel: "claude-sonnet-4-5-20250929",
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    modelMap: {
      "openai-codex:claude-sonnet-4-5-20250929": "gpt-5.1-codex"
    }
  });
  assert.equal(model, "gpt-5.1-codex");
});

test("resolveMappedModel supports provider-prefixed alias prefix matching", () => {
  const model = resolveMappedModel({
    requestedModel: "claude-sonnet-4-5-20250929",
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    modelMap: {
      "openai-codex:claude-sonnet-4-5": "gpt-5.1-codex-mini"
    }
  });
  assert.equal(model, "gpt-5.1-codex-mini");
});

test("listAdvertisedModels includes aliases and mapped targets", () => {
  const models = listAdvertisedModels({
    provider: "openai-codex",
    platform: "openai-codex",
    fallbackModel: "codex-mini-latest",
    modelMap: {
      "claude-sonnet-4-5": { "openai-codex": "gpt-5" },
      "claude-opus-4-1": "gpt-5-mini"
    }
  });

  assert.ok(models.includes("claude-sonnet-4-5"));
  assert.ok(models.includes("gpt-5"));
  assert.ok(models.includes("claude-opus-4-1"));
  assert.ok(models.includes("gpt-5-mini"));
  assert.ok(models.includes("codex-mini-latest"));
});

test("listAdvertisedModels normalizes provider-prefixed aliases for active provider", () => {
  const models = listAdvertisedModels({
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    modelMap: {
      "openai-codex:claude-sonnet-4-5": "gpt-5.1-codex-mini",
      "anthropic:claude-sonnet-4-5": "claude-sonnet-4-5"
    }
  });

  assert.ok(models.includes("claude-sonnet-4-5"));
  assert.ok(models.includes("gpt-5.1-codex-mini"));
  assert.equal(models.includes("anthropic:claude-sonnet-4-5"), false);
});

test("resolveModelRoute supports per-model reasoning mapping", () => {
  const route = resolveModelRoute({
    requestedModel: "claude-opus-4-6",
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    requestBody: {
      effort: "max"
    },
    modelMap: {
      "openai-codex:claude-opus-4-6": {
        model: "gpt-5.1-codex",
        effort: {
          max: "xhigh",
          high: "high",
          medium: "medium",
          low: "minimal"
        }
      }
    }
  });

  assert.equal(route.modelId, "gpt-5.1-codex");
  assert.equal(route.sourceEffort, "max");
  assert.equal(route.hasReasoningOverride, true);
  assert.equal(route.reasoning, "xhigh");
});

test("resolveModelRoute infers effort from thinking budget_tokens", () => {
  const route = resolveModelRoute({
    requestedModel: "claude-opus-4-6",
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    requestBody: {
      thinking: { type: "enabled", budget_tokens: 12000 }
    },
    modelMap: {
      "openai-codex:claude-opus-4-6": {
        model: "gpt-5.1-codex",
        reasoning: {
          high: "high",
          default: "medium"
        }
      }
    }
  });

  assert.equal(route.sourceEffort, "high");
  assert.equal(route.hasReasoningOverride, true);
  assert.equal(route.reasoning, "high");
});

test("resolveModelRoute supports explicit reasoning disable", () => {
  const route = resolveModelRoute({
    requestedModel: "claude-opus-4-6",
    provider: "openai-codex",
    fallbackModel: "gpt-5.1-codex-mini",
    requestBody: {
      effort: "low"
    },
    modelMap: {
      "openai-codex:claude-opus-4-6": {
        model: "gpt-5.1-codex",
        effort: {
          low: "none"
        }
      }
    }
  });

  assert.equal(route.hasReasoningOverride, true);
  assert.equal(route.reasoning, "");
});
