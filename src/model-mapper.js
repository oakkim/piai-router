function normalizeKey(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitProviderPrefixedAlias(value) {
  const key = normalizeKey(value);
  const sepIndex = key.indexOf(":");
  if (sepIndex <= 0 || sepIndex >= key.length - 1) {
    return null;
  }
  const provider = normalizeKey(key.slice(0, sepIndex));
  const model = normalizeKey(key.slice(sepIndex + 1));
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function resolveProviderKey(params) {
  const provider = normalizeKey(params?.provider);
  if (provider) {
    return provider;
  }
  return normalizeKey(params?.platform);
}

function normalizeSourceEffort(value) {
  const v = normalizeKey(value).toLowerCase();
  if (!v) {
    return "";
  }
  if (["none", "off", "disabled", "disable", "false", "0"].includes(v)) {
    return "none";
  }
  if (["low", "minimal"].includes(v)) {
    return "low";
  }
  if (v === "medium") {
    return "medium";
  }
  if (v === "high") {
    return "high";
  }
  if (["max", "xhigh", "maximum"].includes(v)) {
    return "max";
  }
  return "";
}

function normalizeTargetReasoning(value) {
  const v = normalizeKey(value).toLowerCase();
  if (!v) {
    return undefined;
  }
  if (["none", "off", "disabled", "disable", "false", "0"].includes(v)) {
    return "";
  }
  if (v === "max") {
    return "xhigh";
  }
  if (["minimal", "low", "medium", "high", "xhigh"].includes(v)) {
    return v;
  }
  return undefined;
}

function inferSourceEffortFromBudgetTokens(body) {
  const thinking = isRecord(body?.thinking) ? body.thinking : null;
  if (!thinking) {
    return "";
  }
  const budgetRaw = thinking.budget_tokens ?? thinking.budgetTokens;
  const budget = Number(budgetRaw);
  if (!Number.isFinite(budget)) {
    return "";
  }
  if (budget <= 0) {
    return "none";
  }
  if (budget <= 2048) {
    return "low";
  }
  if (budget <= 8192) {
    return "medium";
  }
  if (budget <= 24576) {
    return "high";
  }
  return "max";
}

function inferSourceEffortFromBody(body) {
  const directCandidates = [
    body?.effort,
    body?.metadata?.effort,
    body?.metadata?.reasoning_effort,
    body?.thinking?.effort,
    isRecord(body?.reasoning) ? body.reasoning.effort : ""
  ];
  for (const candidate of directCandidates) {
    const normalized = normalizeSourceEffort(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return inferSourceEffortFromBudgetTokens(body);
}

function hasRouteFields(entry) {
  if (!isRecord(entry)) {
    return false;
  }
  return (
    typeof entry.model === "string" ||
    typeof entry.target === "string" ||
    typeof entry.to === "string" ||
    entry.reasoning !== undefined ||
    entry.effort !== undefined
  );
}

function parseReasoningConfig(raw) {
  if (raw === undefined) {
    return null;
  }
  if (typeof raw === "string") {
    const normalized = normalizeTargetReasoning(raw);
    if (normalized === undefined) {
      return null;
    }
    return {
      type: "fixed",
      value: normalized
    };
  }
  if (!isRecord(raw)) {
    return null;
  }

  const values = {};
  let defaultValue;

  for (const [k, v] of Object.entries(raw)) {
    const normalizedValue = normalizeTargetReasoning(v);
    if (normalizedValue === undefined) {
      continue;
    }
    const key = normalizeKey(k).toLowerCase();
    if (key === "default") {
      defaultValue = normalizedValue;
      continue;
    }
    const normalizedSource = normalizeSourceEffort(key);
    if (!normalizedSource) {
      continue;
    }
    values[normalizedSource] = normalizedValue;
  }

  if (Object.keys(values).length === 0 && defaultValue === undefined) {
    return null;
  }

  return {
    type: "map",
    values,
    defaultValue
  };
}

function resolveReasoningOverride(reasoningConfig, sourceEffort) {
  if (!reasoningConfig) {
    return { hasOverride: false, reasoning: "" };
  }
  if (reasoningConfig.type === "fixed") {
    return { hasOverride: true, reasoning: reasoningConfig.value || "" };
  }
  if (!sourceEffort) {
    if (reasoningConfig.defaultValue !== undefined) {
      return { hasOverride: true, reasoning: reasoningConfig.defaultValue || "" };
    }
    return { hasOverride: false, reasoning: "" };
  }
  if (Object.prototype.hasOwnProperty.call(reasoningConfig.values, sourceEffort)) {
    return { hasOverride: true, reasoning: reasoningConfig.values[sourceEffort] || "" };
  }
  if (reasoningConfig.defaultValue !== undefined) {
    return { hasOverride: true, reasoning: reasoningConfig.defaultValue || "" };
  }
  return { hasOverride: false, reasoning: "" };
}

function extractMappedModelId(entry) {
  if (typeof entry === "string") {
    return entry.trim();
  }
  if (!isRecord(entry)) {
    return "";
  }
  const direct = entry.model || entry.target || entry.to;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }
  return "";
}

function resolveEntryVariant(entry, provider) {
  if (typeof entry === "string") {
    return entry;
  }
  if (!isRecord(entry)) {
    return null;
  }
  if (hasRouteFields(entry)) {
    return entry;
  }
  if (provider && entry[provider] !== undefined) {
    return entry[provider];
  }
  if (entry.default !== undefined) {
    return entry.default;
  }
  return null;
}

function parseRouteEntry(entry, provider) {
  const variant = resolveEntryVariant(entry, provider);
  if (variant === null || variant === undefined) {
    return null;
  }
  if (typeof variant === "string") {
    const modelId = variant.trim();
    if (!modelId) {
      return null;
    }
    return { modelId, reasoningConfig: null };
  }
  if (!isRecord(variant)) {
    return null;
  }
  const modelId = extractMappedModelId(variant);
  if (!modelId) {
    return null;
  }
  const reasoningConfig = parseReasoningConfig(
    variant.reasoning !== undefined ? variant.reasoning : variant.effort
  );
  return { modelId, reasoningConfig };
}

function buildResolvedRoute(routeEntry, sourceEffort, matchedBy) {
  const reasoning = resolveReasoningOverride(routeEntry.reasoningConfig, sourceEffort);
  return {
    modelId: routeEntry.modelId,
    sourceEffort,
    reasoning: reasoning.reasoning,
    hasReasoningOverride: reasoning.hasOverride,
    matchedBy
  };
}

export function resolveModelRoute(params) {
  const requested = normalizeKey(params.requestedModel);
  const provider = resolveProviderKey(params);
  const fallbackModel = normalizeKey(params.fallbackModel);
  const map = isRecord(params.modelMap) ? params.modelMap : {};
  const sourceEffort = inferSourceEffortFromBody(params.requestBody);

  const tryResolve = (entryKey, entryValue, matchedBy) => {
    const parsed = parseRouteEntry(entryValue, provider);
    if (!parsed || !parsed.modelId) {
      return null;
    }
    return buildResolvedRoute(parsed, sourceEffort, `${matchedBy}:${entryKey}`);
  };

  if (requested) {
    if (provider) {
      const providerSpecificKey = `${provider}:${requested}`;
      if (map[providerSpecificKey] !== undefined) {
        const resolved = tryResolve(providerSpecificKey, map[providerSpecificKey], "exact_provider");
        if (resolved) {
          return resolved;
        }
      }
    }

    if (map[requested] !== undefined) {
      const resolved = tryResolve(requested, map[requested], "exact");
      if (resolved) {
        return resolved;
      }
    }

    if (provider) {
      for (const [alias, value] of Object.entries(map)) {
        if (alias === "default" || !alias) {
          continue;
        }
        const parsedAlias = splitProviderPrefixedAlias(alias);
        if (!parsedAlias || parsedAlias.provider !== provider) {
          continue;
        }
        if (!requested.startsWith(parsedAlias.model)) {
          continue;
        }
        const resolved = tryResolve(alias, value, "prefix_provider");
        if (resolved) {
          return resolved;
        }
      }
    }

    for (const [alias, value] of Object.entries(map)) {
      if (alias === "default" || !alias) {
        continue;
      }
      if (splitProviderPrefixedAlias(alias)) {
        continue;
      }
      if (!requested.startsWith(alias)) {
        continue;
      }
      const resolved = tryResolve(alias, value, "prefix");
      if (resolved) {
        return resolved;
      }
    }
  }

  if (map.default !== undefined) {
    const defaultResolved = tryResolve("default", map.default, "default");
    if (defaultResolved) {
      return defaultResolved;
    }
  }

  if (requested) {
    const providerLower = provider.toLowerCase();
    const isOpenAIStyle = providerLower.includes("openai");
    const isAnthropicStyle = providerLower.includes("anthropic");
    const looksAnthropicModel = requested.startsWith("claude-");
    const looksOpenAIModel =
      requested.startsWith("gpt") || requested.startsWith("o1") || requested.startsWith("o3");

    if (fallbackModel && isOpenAIStyle && looksAnthropicModel) {
      return {
        modelId: fallbackModel,
        sourceEffort,
        reasoning: "",
        hasReasoningOverride: false,
        matchedBy: "fallback_family_mismatch_openai"
      };
    }
    if (fallbackModel && isAnthropicStyle && looksOpenAIModel) {
      return {
        modelId: fallbackModel,
        sourceEffort,
        reasoning: "",
        hasReasoningOverride: false,
        matchedBy: "fallback_family_mismatch_anthropic"
      };
    }

    return {
      modelId: requested,
      sourceEffort,
      reasoning: "",
      hasReasoningOverride: false,
      matchedBy: "passthrough"
    };
  }

  if (fallbackModel) {
    return {
      modelId: fallbackModel,
      sourceEffort,
      reasoning: "",
      hasReasoningOverride: false,
      matchedBy: "fallback_model"
    };
  }

  return {
    modelId: "gpt-5",
    sourceEffort,
    reasoning: "",
    hasReasoningOverride: false,
    matchedBy: "hard_default"
  };
}

export function resolveMappedModel(params) {
  return resolveModelRoute(params).modelId;
}

export function listAdvertisedModels(params) {
  const provider = resolveProviderKey(params);
  const fallbackModel = normalizeKey(params.fallbackModel);
  const map = isRecord(params.modelMap) ? params.modelMap : {};
  const out = new Set();

  if (fallbackModel) {
    out.add(fallbackModel);
  }

  for (const [alias, value] of Object.entries(map)) {
    if (alias !== "default") {
      const parsed = splitProviderPrefixedAlias(alias);
      if (!parsed) {
        out.add(alias);
      } else if (provider && parsed.provider === provider) {
        out.add(parsed.model);
      }
    }
    const parsedEntry = parseRouteEntry(value, provider);
    if (parsedEntry?.modelId) {
      out.add(parsedEntry.modelId);
    }
  }

  return Array.from(out).filter(Boolean).sort((a, b) => a.localeCompare(b));
}
