import test from "node:test";
import assert from "node:assert/strict";
import {
  convertPiEventToAnthropicSseRecords,
  createAnthropicStreamState
} from "../src/anthropic-bridge.js";

test("convertPiEventToAnthropicSseRecords maps text and toolcall stream", () => {
  const state = createAnthropicStreamState({ model: "claude-sonnet-4-5", messageId: "msg_test" });
  const events = [
    { type: "start" },
    { type: "text_start", contentIndex: 0 },
    { type: "text_delta", contentIndex: 0, delta: "hello" },
    { type: "text_end", contentIndex: 0, content: "hello" },
    {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        content: [
          { type: "text", text: "hello" },
          { type: "toolCall", id: "call_1", name: "Bash", arguments: {} }
        ]
      }
    },
    { type: "toolcall_delta", contentIndex: 1, delta: "{\"command\":\"ls\"}" },
    {
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { type: "toolCall", id: "call_1", name: "Bash", arguments: { command: "ls" } }
    },
    {
      type: "done",
      reason: "toolUse",
      message: {
        usage: { input: 10, output: 12, cacheRead: 1, cacheWrite: 0 }
      }
    }
  ];

  const records = events.flatMap((event) => convertPiEventToAnthropicSseRecords(event, state));
  const eventNames = records.map((record) => record.event);

  assert.equal(eventNames[0], "message_start");
  assert.ok(eventNames.includes("content_block_start"));
  assert.ok(eventNames.includes("content_block_delta"));
  assert.ok(eventNames.includes("content_block_stop"));
  assert.ok(eventNames.includes("message_delta"));
  assert.equal(eventNames[eventNames.length - 1], "message_stop");

  const messageDelta = records.find((record) => record.event === "message_delta");
  assert.equal(messageDelta.data.delta.stop_reason, "tool_use");
  assert.equal(messageDelta.data.usage.input_tokens, 10);
  assert.equal(messageDelta.data.usage.output_tokens, 12);
});

test("convertPiEventToAnthropicSseRecords maps errors", () => {
  const state = createAnthropicStreamState({ model: "claude-sonnet-4-5", messageId: "msg_error" });
  const records = convertPiEventToAnthropicSseRecords(
    {
      type: "error",
      error: { errorMessage: "upstream failed" }
    },
    state
  );
  const errorRecord = records.find((record) => record.event === "error");
  assert.ok(errorRecord);
  assert.equal(errorRecord.data.error.message, "upstream failed");
});

test("convertPiEventToAnthropicSseRecords backfills Task prompt on toolcall_end", () => {
  const state = createAnthropicStreamState({ model: "claude-sonnet-4-5", messageId: "msg_task" });
  const events = [
    { type: "start" },
    {
      type: "toolcall_start",
      contentIndex: 0,
      partial: {
        content: [{ type: "toolCall", id: "call_task_1", name: "Task", arguments: {} }]
      }
    },
    { type: "toolcall_delta", contentIndex: 0, delta: "{\"resume\":\"a8a2fb7\"}" },
    {
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: {
        type: "toolCall",
        id: "call_task_1",
        name: "Task",
        arguments: { description: "Continue project analysis", subagent_type: "Explore", resume: "a8a2fb7" }
      }
    }
  ];

  const records = events.flatMap((event) => convertPiEventToAnthropicSseRecords(event, state));
  const toolDelta = records.find(
    (record) =>
      record.event === "content_block_delta" &&
      record.data &&
      record.data.delta &&
      record.data.delta.type === "input_json_delta"
  );

  assert.ok(toolDelta);
  const parsed = JSON.parse(toolDelta.data.delta.partial_json);
  assert.equal(parsed.prompt, "Continue project analysis");
});

test("convertPiEventToAnthropicSseRecords maps thinking stream to anthropic thinking deltas", () => {
  const state = createAnthropicStreamState({ model: "claude-sonnet-4-5", messageId: "msg_thinking" });
  const events = [
    { type: "start" },
    { type: "thinking_start", contentIndex: 0 },
    { type: "thinking_delta", contentIndex: 0, delta: "step by step" },
    { type: "thinking_end", contentIndex: 0 },
    { type: "done", reason: "stop", message: { usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } } }
  ];

  const records = events.flatMap((event) => convertPiEventToAnthropicSseRecords(event, state));
  const starts = records.filter((record) => record.event === "content_block_start");
  assert.equal(starts.length > 0, true);
  assert.equal(starts[0].data.content_block.type, "thinking");

  const thinkingDeltas = records
    .filter(
      (record) =>
        record.event === "content_block_delta" &&
        record.data &&
        record.data.delta &&
        record.data.delta.type === "thinking_delta"
    )
    .map((record) => record.data.delta.thinking);

  assert.ok(thinkingDeltas.includes("step by step"));

  const signatureDelta = records.find(
    (record) =>
      record.event === "content_block_delta" &&
      record.data &&
      record.data.delta &&
      record.data.delta.type === "signature_delta"
  );
  assert.ok(signatureDelta);
  assert.equal(typeof signatureDelta.data.delta.signature, "string");
});

test("thinking block and text block do not reuse same SSE index", () => {
  const state = createAnthropicStreamState({ model: "claude-sonnet-4-5", messageId: "msg_idx" });
  const events = [
    { type: "start" },
    { type: "thinking_start", contentIndex: 0 },
    { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
    { type: "thinking_end", contentIndex: 0 },
    { type: "text_start", contentIndex: 0 },
    { type: "text_delta", contentIndex: 0, delta: "final answer" },
    { type: "text_end", contentIndex: 0 }
  ];

  const records = events.flatMap((event) => convertPiEventToAnthropicSseRecords(event, state));
  const starts = records
    .filter((record) => record.event === "content_block_start")
    .map((record) => record.data.index);

  assert.equal(starts.length >= 2, true);
  assert.notEqual(starts[0], starts[1]);
});

test("convertPiEventToAnthropicSseRecords suppresses thinking when configured", () => {
  const state = createAnthropicStreamState({
    model: "claude-sonnet-4-5",
    messageId: "msg_no_thinking",
    suppressThinking: true
  });
  const events = [
    { type: "thinking_start", contentIndex: 0 },
    { type: "thinking_delta", contentIndex: 0, delta: "internal" },
    { type: "thinking_end", contentIndex: 0 }
  ];

  const records = events.flatMap((event) => convertPiEventToAnthropicSseRecords(event, state));
  assert.equal(records.length, 0);
});
