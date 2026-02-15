import test from "node:test";
import assert from "node:assert/strict";
import {
  anthropicRequestToPiContext,
  estimateInputTokensApprox,
  piAssistantToAnthropicMessage
} from "../src/anthropic-bridge.js";

test("anthropicRequestToPiContext converts tool_use/tool_result flow", () => {
  const context = anthropicRequestToPiContext({
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: "You are helpful" }],
    messages: [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "ls" } }]
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "call-1", content: "ok", is_error: false },
          { type: "text", text: "next question" }
        ]
      }
    ],
    tools: [
      {
        name: "Bash",
        description: "Run shell commands",
        input_schema: {
          type: "object",
          properties: { command: { type: "string" } },
          required: ["command"]
        }
      }
    ]
  });

  assert.equal(context.systemPrompt, "You are helpful");
  assert.equal(context.messages[0].role, "assistant");
  assert.equal(context.messages[0].content[0].type, "toolCall");
  assert.equal(context.messages[1].role, "toolResult");
  assert.equal(context.messages[1].toolCallId, "call-1");
  assert.equal(context.messages[1].toolName, "Bash");
  assert.equal(context.messages[2].role, "user");
  assert.equal(context.tools[0].name, "Bash");
});

test("piAssistantToAnthropicMessage converts text and toolCall blocks", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      stopReason: "toolUse",
      usage: { input: 10, output: 20, cacheRead: 3, cacheWrite: 1 },
      content: [
        { type: "text", text: "I will run a command." },
        { type: "toolCall", id: "call-123", name: "Bash", arguments: { command: "pwd" } }
      ]
    }
  });

  assert.equal(output.type, "message");
  assert.equal(output.role, "assistant");
  assert.equal(output.model, "claude-sonnet-4-5");
  assert.equal(output.stop_reason, "tool_use");
  assert.equal(output.content[0].type, "text");
  assert.equal(output.content[1].type, "tool_use");
  assert.deepEqual(output.content[1].input, { command: "pwd" });
  assert.equal(output.usage.input_tokens, 10);
  assert.equal(output.usage.output_tokens, 20);
});

test("piAssistantToAnthropicMessage backfills Task prompt when missing", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      stopReason: "toolUse",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      content: [
        {
          type: "toolCall",
          id: "call-task-1",
          name: "Task",
          arguments: { description: "Continue project analysis", subagent_type: "Explore", resume: "a8a2fb7" }
        }
      ]
    }
  });

  assert.equal(output.content[0].type, "tool_use");
  assert.equal(output.content[0].name, "Task");
  assert.equal(output.content[0].input.prompt, "Continue project analysis");
});

test("piAssistantToAnthropicMessage recovers malformed tool JSON with raw newlines", () => {
  const malformedArgs =
    "{\n" +
    "\"file_path\":\"/tmp/README.ko.md\",\n" +
    "\"old_string\":\"첫 줄\n둘째 줄\",\n" +
    "\"new_string\":\"교체\"\n" +
    "}";

  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      stopReason: "toolUse",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      content: [
        {
          type: "toolCall",
          id: "call-edit-1",
          name: "Edit",
          arguments: malformedArgs
        }
      ]
    }
  });

  assert.equal(output.content[0].type, "tool_use");
  assert.equal(output.content[0].name, "Edit");
  assert.equal(output.content[0].input.file_path, "/tmp/README.ko.md");
  assert.equal(output.content[0].input.old_string, "첫 줄\n둘째 줄");
  assert.equal(output.content[0].input.new_string, "교체");
});

test("piAssistantToAnthropicMessage converts thinking blocks to anthropic thinking blocks", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "final answer" }
      ]
    }
  });

  assert.equal(output.content[0].type, "thinking");
  assert.equal(output.content[0].thinking, "internal reasoning");
  assert.equal(typeof output.content[0].signature, "string");
  assert.equal(output.content[0].signature.startsWith("synthetic."), true);
  assert.equal(output.content[1].type, "text");
  assert.equal(output.content[1].text, "final answer");
});

test("piAssistantToAnthropicMessage can suppress thinking blocks", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    suppressThinking: true,
    message: {
      stopReason: "stop",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "{\"ok\":true}" }
      ]
    }
  });

  assert.equal(output.content.length, 1);
  assert.equal(output.content[0].type, "text");
  assert.equal(output.content[0].text, "{\"ok\":true}");
});

test("piAssistantToAnthropicMessage generates deterministic thinking signatures", () => {
  const baseMessage = {
    stopReason: "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }
  };

  const outputA = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      ...baseMessage,
      content: [{ type: "thinking", thinking: "line1\r\nline2" }]
    }
  });

  const outputB = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      ...baseMessage,
      content: [{ type: "thinking", thinking: "line1\nline2" }]
    }
  });

  assert.equal(outputA.content[0].signature, outputB.content[0].signature);
});

test("piAssistantToAnthropicMessage suppresses fallback thinking when suppressed", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    suppressThinking: true,
    message: {
      stopReason: "error",
      errorMessage: "Request was aborted",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      content: []
    }
  });

  assert.equal(output.content.length, 0);
});

test("piAssistantToAnthropicMessage falls back to thinking block for empty error message", () => {
  const output = piAssistantToAnthropicMessage({
    requestedModel: "claude-sonnet-4-5",
    resolvedModel: "gpt-5",
    message: {
      stopReason: "error",
      errorMessage: "Request was aborted",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      content: []
    }
  });

  assert.equal(output.content.length, 1);
  assert.equal(output.content[0].type, "thinking");
  assert.equal(output.content[0].thinking, "Request was aborted");
  assert.equal(typeof output.content[0].signature, "string");
});

test("estimateInputTokensApprox returns positive token estimate", () => {
  const tokens = estimateInputTokensApprox({
    system: "system prompt",
    messages: [
      { role: "user", content: "hello world" },
      { role: "assistant", content: [{ type: "text", text: "hi there" }] }
    ]
  });
  assert.ok(tokens > 0);
});
