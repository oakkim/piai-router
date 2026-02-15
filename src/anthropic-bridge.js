import { createHash } from "node:crypto";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeToolCallId(raw) {
  const value = toText(raw).trim();
  if (!value) {
    return `tool_${Math.random().toString(36).slice(2, 10)}`;
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function extractThinkingText(block) {
  if (!isRecord(block)) {
    return "";
  }
  if (typeof block.thinking === "string") {
    return block.thinking;
  }
  if (typeof block.text === "string") {
    return block.text;
  }
  return "";
}

function normalizeThinkingText(thinkingText) {
  return toText(thinkingText).replace(/\r\n/g, "\n");
}

function buildThinkingSignature(thinkingText) {
  const normalizedThinking = normalizeThinkingText(thinkingText);
  const digest = createHash("sha256").update(normalizedThinking).digest("base64");
  return `synthetic.${digest}`;
}

function normalizeToolArguments(name, rawArguments) {
  const args = isRecord(rawArguments) ? { ...rawArguments } : {};
  if (name !== "Task") {
    return args;
  }

  const existingPrompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (existingPrompt) {
    args.prompt = existingPrompt;
    return args;
  }

  const description = typeof args.description === "string" ? args.description.trim() : "";
  if (description) {
    args.prompt = description;
    return args;
  }

  const resumeId = typeof args.resume === "string" ? args.resume.trim() : "";
  if (resumeId) {
    args.prompt = `Continue task ${resumeId}`;
    return args;
  }

  args.prompt = "Continue with the current task.";
  return args;
}

function anthropicContentToArray(content) {
  if (Array.isArray(content)) {
    return content.filter((block) => isRecord(block));
  }
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return [];
}

function convertAnthropicImageToPi(block) {
  const source = isRecord(block.source) ? block.source : null;
  if (!source || source.type !== "base64") {
    return null;
  }
  const data = typeof source.data === "string" ? source.data : "";
  const mimeType = typeof source.media_type === "string" ? source.media_type : "image/png";
  if (!data) {
    return null;
  }
  return { type: "image", data, mimeType };
}

function convertAnthropicUserBlockToPi(block) {
  if (block.type === "text") {
    return { type: "text", text: toText(block.text) };
  }
  if (block.type === "image") {
    return convertAnthropicImageToPi(block);
  }
  return null;
}

function convertAnthropicToolResultContentToPi(content) {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ type: "text", text: toText(content) }];
  }

  const out = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    const converted = convertAnthropicUserBlockToPi(block);
    if (converted) {
      out.push(converted);
    }
  }
  if (out.length > 0) {
    return out;
  }
  return [{ type: "text", text: "" }];
}

function usageToAnthropic(usage) {
  const data = isRecord(usage) ? usage : EMPTY_USAGE;
  return {
    input_tokens: Number(data.input) || 0,
    output_tokens: Number(data.output) || 0,
    cache_read_input_tokens: Number(data.cacheRead) || 0,
    cache_creation_input_tokens: Number(data.cacheWrite) || 0
  };
}

function extractTextContentForTokenCount(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = [];
  for (const block of content) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "text") {
      parts.push(toText(block.text));
    } else if (block.type === "tool_result") {
      parts.push(toText(block.content));
    } else if (block.type === "tool_use") {
      parts.push(`${toText(block.name)} ${toText(block.input)}`);
    } else if (block.type === "image") {
      parts.push("[image]");
    }
  }
  return parts.join("\n");
}

export function extractSystemPrompt(system) {
  if (typeof system === "string") {
    return system;
  }
  if (!Array.isArray(system)) {
    return "";
  }
  return system
    .filter((item) => isRecord(item) && item.type === "text")
    .map((item) => toText(item.text))
    .join("\n");
}

export function anthropicToolsToPiTools(tools) {
  if (!Array.isArray(tools)) {
    return [];
  }
  return tools
    .filter((tool) => isRecord(tool) && typeof tool.name === "string" && tool.name.trim())
    .map((tool) => ({
      name: tool.name.trim(),
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: isRecord(tool.input_schema) ? tool.input_schema : { type: "object", properties: {} }
    }));
}

export function anthropicRequestToPiContext(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const out = [];
  const now = Date.now();
  const toolNameById = new Map();

  for (const message of messages) {
    if (!isRecord(message) || typeof message.role !== "string") {
      continue;
    }
    const role = message.role;
    const blocks = anthropicContentToArray(message.content);

    if (role === "assistant") {
      const assistantBlocks = [];
      for (const block of blocks) {
        if (block.type === "thinking") {
          const thinking = toText(block.thinking);
          if (thinking) {
            assistantBlocks.push({ type: "thinking", thinking });
          }
          continue;
        }
        if (block.type === "text") {
          assistantBlocks.push({ type: "text", text: toText(block.text) });
          continue;
        }
        if (block.type === "tool_use") {
          const id = normalizeToolCallId(block.id);
          const name = toText(block.name || "tool");
          const args = isRecord(block.input) ? block.input : {};
          toolNameById.set(id, name);
          assistantBlocks.push({ type: "toolCall", id, name, arguments: args });
        }
      }
      if (assistantBlocks.length > 0) {
        out.push({
          role: "assistant",
          content: assistantBlocks,
          api: "anthropic-messages",
          provider: "anthropic",
          model: toText(body?.model || "anthropic-history"),
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: "stop",
          timestamp: now
        });
      }
      continue;
    }

    if (role !== "user") {
      continue;
    }

    const pendingUserBlocks = [];
    const flushPendingUserBlocks = () => {
      if (pendingUserBlocks.length === 0) {
        return;
      }
      out.push({
        role: "user",
        content: pendingUserBlocks.length === 1 && pendingUserBlocks[0].type === "text"
          ? pendingUserBlocks[0].text
          : pendingUserBlocks.splice(0),
        timestamp: now
      });
      pendingUserBlocks.length = 0;
    };

    if (typeof message.content === "string") {
      out.push({ role: "user", content: message.content, timestamp: now });
      continue;
    }

    for (const block of blocks) {
      if (block.type === "tool_result") {
        flushPendingUserBlocks();
        const toolCallId = normalizeToolCallId(block.tool_use_id || block.toolUseId || block.tool_call_id);
        out.push({
          role: "toolResult",
          toolCallId,
          toolName: toolNameById.get(toolCallId) || "tool",
          content: convertAnthropicToolResultContentToPi(block.content),
          isError: block.is_error === true,
          timestamp: now
        });
        continue;
      }

      const converted = convertAnthropicUserBlockToPi(block);
      if (converted) {
        pendingUserBlocks.push(converted);
      }
    }
    flushPendingUserBlocks();
  }

  return {
    systemPrompt: extractSystemPrompt(body?.system),
    messages: out,
    tools: anthropicToolsToPiTools(body?.tools)
  };
}

export function mapPiStopReasonToAnthropic(stopReason) {
  switch (stopReason) {
    case "toolUse":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "stop":
      return "end_turn";
    case "aborted":
    case "error":
      return "end_turn";
    default:
      return "end_turn";
  }
}

export function piAssistantToAnthropicMessage(params) {
  const message = isRecord(params?.message) ? params.message : {};
  const suppressThinking = params?.suppressThinking === true;
  const model = toText(params?.requestedModel || params?.resolvedModel || "unknown-model");
  const id = toText(params?.id || `msg_${Date.now().toString(36)}`);
  const content = [];

  const blocks = Array.isArray(message.content) ? message.content : [];
  for (const block of blocks) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type === "thinking" || block.type === "reasoning") {
      if (suppressThinking) {
        continue;
      }
      const thinkingText = extractThinkingText(block);
      if (thinkingText) {
        content.push({
          type: "thinking",
          thinking: thinkingText,
          signature: buildThinkingSignature(thinkingText)
        });
      }
      continue;
    }
    if (block.type === "text") {
      content.push({ type: "text", text: toText(block.text) });
      continue;
    }
    if (block.type === "toolCall") {
      const name = toText(block.name || "tool");
      content.push({
        type: "tool_use",
        id: normalizeToolCallId(block.id),
        name,
        input: normalizeToolArguments(name, block.arguments)
      });
    }
  }

  if (
    content.length === 0 &&
    !suppressThinking &&
    typeof message.errorMessage === "string" &&
    message.errorMessage.trim()
  ) {
    const thinkingText = message.errorMessage.trim();
    content.push({
      type: "thinking",
      thinking: thinkingText,
      signature: buildThinkingSignature(thinkingText)
    });
  }

  return {
    id,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: mapPiStopReasonToAnthropic(message.stopReason),
    stop_sequence: null,
    usage: usageToAnthropic(message.usage)
  };
}

function buildMessageStartEventData(state) {
  return {
    type: "message_start",
    message: {
      id: state.messageId,
      type: "message",
      role: "assistant",
      model: state.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0
      }
    }
  };
}

function ensureMessageStart(state, records) {
  if (state.started) {
    return;
  }
  state.started = true;
  records.push({ event: "message_start", data: buildMessageStartEventData(state) });
}

function blockKey(channel, contentIndex) {
  return `${channel}:${contentIndex}`;
}

function allocateBlockIndex(state, channel, contentIndex) {
  const normalizedContentIndex = Number.isFinite(contentIndex) ? contentIndex : 0;
  const key = blockKey(channel, normalizedContentIndex);
  const existing = state.openBlockIndexByKey.get(key);
  if (typeof existing === "number") {
    return existing;
  }
  const next = state.nextBlockIndex;
  state.nextBlockIndex += 1;
  state.openBlockIndexByKey.set(key, next);
  state.keyByBlockIndex.set(next, key);
  return next;
}

function findExistingBlockIndex(state, channel, contentIndex) {
  const normalizedContentIndex = Number.isFinite(contentIndex) ? contentIndex : 0;
  const key = blockKey(channel, normalizedContentIndex);
  const existing = state.openBlockIndexByKey.get(key);
  return typeof existing === "number" ? existing : null;
}

function releaseBlockIndex(state, index) {
  const key = state.keyByBlockIndex.get(index);
  if (typeof key === "string") {
    const linkedIndex = state.openBlockIndexByKey.get(key);
    if (linkedIndex === index) {
      state.openBlockIndexByKey.delete(key);
    }
  }
  state.keyByBlockIndex.delete(index);
}

function readToolCallFromEvent(event) {
  if (isRecord(event.toolCall)) {
    return event.toolCall;
  }
  if (isRecord(event.partial) && Array.isArray(event.partial.content)) {
    const block = event.partial.content[event.contentIndex];
    if (isRecord(block) && block.type === "toolCall") {
      return block;
    }
  }
  return null;
}

function closeOpenBlocks(state, records) {
  for (const blockIndex of state.openBlocks) {
    if (state.thinkingTextByBlockIndex.has(blockIndex)) {
      const thinking = state.thinkingTextByBlockIndex.get(blockIndex) || "";
      records.push({
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "signature_delta", signature: buildThinkingSignature(thinking) }
        }
      });
      state.thinkingTextByBlockIndex.delete(blockIndex);
    }
    records.push({
      event: "content_block_stop",
      data: { type: "content_block_stop", index: blockIndex }
    });
    releaseBlockIndex(state, blockIndex);
  }
  state.openBlocks.clear();
  state.toolMetaByBlockIndex.clear();
  state.openBlockIndexByKey.clear();
  state.keyByBlockIndex.clear();
  state.pendingTextContentIndexes.clear();
  state.thinkingTextByBlockIndex.clear();
}

export function createAnthropicStreamState(params) {
  const model = toText(params?.model || "unknown-model");
  const messageId = toText(params?.messageId || `msg_${Date.now().toString(36)}`);
  return {
    model,
    messageId,
    suppressThinking: params?.suppressThinking === true,
    started: false,
    nextBlockIndex: 0,
    openBlockIndexByKey: new Map(),
    keyByBlockIndex: new Map(),
    openBlocks: new Set(),
    toolMetaByBlockIndex: new Map(),
    thinkingTextByBlockIndex: new Map(),
    pendingTextContentIndexes: new Set()
  };
}

function ensureThinkingBlockOpen(state, records, index) {
  if (!state.openBlocks.has(index)) {
    state.openBlocks.add(index);
    records.push({
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "" }
      }
    });
  }
  if (!state.thinkingTextByBlockIndex.has(index)) {
    state.thinkingTextByBlockIndex.set(index, "");
  }
}

export function convertPiEventToAnthropicSseRecords(event, state) {
  const records = [];
  if (!isRecord(event)) {
    return records;
  }

  const kind = event.type;

  if (
    state?.suppressThinking === true &&
    (kind === "thinking_start" || kind === "thinking_delta" || kind === "thinking_end")
  ) {
    return records;
  }

  if (kind === "start") {
    ensureMessageStart(state, records);
    return records;
  }

  if (kind === "thinking_start") {
    ensureMessageStart(state, records);
    const index = allocateBlockIndex(state, "thinking", Number(event.contentIndex) || 0);
    ensureThinkingBlockOpen(state, records, index);
    return records;
  }

  if (kind === "thinking_delta") {
    ensureMessageStart(state, records);
    const index = allocateBlockIndex(state, "thinking", Number(event.contentIndex) || 0);
    ensureThinkingBlockOpen(state, records, index);
    const currentThinking = state.thinkingTextByBlockIndex.get(index) || "";
    const nextThinking = currentThinking + toText(event.delta);
    state.thinkingTextByBlockIndex.set(index, nextThinking);
    records.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking: toText(event.delta) }
      }
    });
    return records;
  }

  if (kind === "thinking_end") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const index = findExistingBlockIndex(state, "thinking", contentIndex);
    if (index == null) {
      return records;
    }
    if (!state.openBlocks.has(index) && !state.thinkingTextByBlockIndex.has(index)) {
      releaseBlockIndex(state, index);
      return records;
    }
    ensureThinkingBlockOpen(state, records, index);
    const thinking = state.thinkingTextByBlockIndex.get(index) || "";
    records.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: buildThinkingSignature(thinking) }
      }
    });
    state.thinkingTextByBlockIndex.delete(index);
    state.openBlocks.delete(index);
    releaseBlockIndex(state, index);
    records.push({
      event: "content_block_stop",
      data: { type: "content_block_stop", index }
    });
    return records;
  }

  if (kind === "text_start") {
    const contentIndex = Number(event.contentIndex) || 0;
    state.pendingTextContentIndexes.add(contentIndex);
    return records;
  }

  if (kind === "text_delta") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const index = allocateBlockIndex(state, "text", contentIndex);
    state.pendingTextContentIndexes.delete(contentIndex);
    if (!state.openBlocks.has(index)) {
      state.openBlocks.add(index);
      records.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" }
        }
      });
    }
    records.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: toText(event.delta) }
      }
    });
    return records;
  }

  if (kind === "text_end") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const index = findExistingBlockIndex(state, "text", contentIndex);
    if (index == null) {
      state.pendingTextContentIndexes.delete(contentIndex);
      return records;
    }
    if (!state.openBlocks.has(index)) {
      state.pendingTextContentIndexes.delete(contentIndex);
      releaseBlockIndex(state, index);
      return records;
    }
    state.openBlocks.delete(index);
    releaseBlockIndex(state, index);
    records.push({
      event: "content_block_stop",
      data: { type: "content_block_stop", index }
    });
    return records;
  }

  if (kind === "toolcall_start") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const index = allocateBlockIndex(state, "tool", contentIndex);
    const toolCall = readToolCallFromEvent(event);
    const name = toText(toolCall?.name || "tool");
    const id = normalizeToolCallId(toolCall?.id);
    state.toolMetaByBlockIndex.set(index, { name, id });
    state.openBlocks.add(index);
    records.push({
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index,
        content_block: {
          type: "tool_use",
          id,
          name,
          input: {}
        }
      }
    });
    return records;
  }

  if (kind === "toolcall_delta") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const index = allocateBlockIndex(state, "tool", contentIndex);
    const toolCall = readToolCallFromEvent(event);
    const knownMeta = state.toolMetaByBlockIndex.get(index);
    const name = toText(toolCall?.name || knownMeta?.name || "tool");
    const id = normalizeToolCallId(toolCall?.id || knownMeta?.id);
    state.toolMetaByBlockIndex.set(index, { name, id });
    if (!state.openBlocks.has(index)) {
      state.openBlocks.add(index);
      records.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id,
            name,
            input: {}
          }
        }
      });
    }
    // We intentionally skip forwarding partial tool JSON deltas and emit a
    // single finalized JSON object at toolcall_end for stability.
    return records;
  }

  if (kind === "toolcall_end") {
    ensureMessageStart(state, records);
    const contentIndex = Number(event.contentIndex) || 0;
    const existingIndex = findExistingBlockIndex(state, "tool", contentIndex);
    const index = existingIndex ?? allocateBlockIndex(state, "tool", contentIndex);
    const toolCall = readToolCallFromEvent(event);
    const knownMeta = state.toolMetaByBlockIndex.get(index);
    const name = toText(toolCall?.name || knownMeta?.name || "tool");
    const id = normalizeToolCallId(toolCall?.id || knownMeta?.id);
    state.toolMetaByBlockIndex.set(index, { name, id });
    if (!state.openBlocks.has(index)) {
      state.openBlocks.add(index);
      records.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id,
            name,
            input: {}
          }
        }
      });
    }
    const args = normalizeToolArguments(name, event.toolCall?.arguments);
    records.push({
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(args) }
      }
    });
    state.openBlocks.delete(index);
    state.toolMetaByBlockIndex.delete(index);
    releaseBlockIndex(state, index);
    records.push({
      event: "content_block_stop",
      data: { type: "content_block_stop", index }
    });
    return records;
  }

  if (kind === "done") {
    ensureMessageStart(state, records);
    closeOpenBlocks(state, records);
    const usage = usageToAnthropic(event.message?.usage);
    records.push({
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: {
          stop_reason: mapPiStopReasonToAnthropic(event.reason || event.message?.stopReason),
          stop_sequence: null
        },
        usage
      }
    });
    records.push({
      event: "message_stop",
      data: { type: "message_stop" }
    });
    return records;
  }

  if (kind === "error") {
    ensureMessageStart(state, records);
    closeOpenBlocks(state, records);
    records.push({
      event: "error",
      data: {
        type: "error",
        error: {
          type: "api_error",
          message: toText(event.error?.errorMessage || event.error?.message || "Upstream stream error")
        }
      }
    });
    return records;
  }

  return records;
}

export function estimateInputTokensApprox(body) {
  const system = extractSystemPrompt(body?.system);
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  let text = system;
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    text += "\n";
    text += extractTextContentForTokenCount(message.content);
  }
  const rough = Math.ceil(text.length / 4);
  return rough > 0 ? rough : 1;
}
