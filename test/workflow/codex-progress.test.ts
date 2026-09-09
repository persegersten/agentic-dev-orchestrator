import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runStreamed: vi.fn() }));
vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    resumeThread() {
      return { id: "thread", runStreamed: mocks.runStreamed };
    }
  },
}));
import { runResumedCodex } from "../../src/codex/runCodex.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("preserves final JSON and usage, filters reasoning and deduplicates command updates", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const stdout = vi.spyOn(console, "log");
  const command = {
    id: "cmd",
    type: "command_execution",
    command: "./mvnw test",
    status: "in_progress",
  };
  mocks.runStreamed.mockResolvedValue({
    events: (async function* () {
      yield { type: "item.started", item: command };
      yield { type: "item.updated", item: command };
      yield {
        type: "item.completed",
        item: { ...command, status: "failed", exit_code: 1 },
      };
      yield {
        type: "item.completed",
        item: { id: "thought", type: "reasoning", text: "private reasoning" },
      };
      yield {
        type: "item.completed",
        item: {
          id: "message",
          type: "agent_message",
          text: '{"summary":"done"}',
        },
      };
      yield { type: "turn.completed", usage: { input_tokens: 10 } };
    })(),
  });
  expect(await runResumedCodex("thread", "Implement", "/workspace")).toEqual({
    finalResponse: '{"summary":"done"}',
    threadId: "thread",
    usage: { input_tokens: 10 },
  });
  expect(
    log.mock.calls.filter(([text]) =>
      String(text).includes("Command in_progress"),
    ),
  ).toHaveLength(1);
  expect(log).toHaveBeenCalledWith(
    "[Codex implementation] Command failed: ./mvnw test (exit 1)",
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("private reasoning");
  expect(stdout).not.toHaveBeenCalled();
});

it.each(["error", "turn.failed", "truncated", "throw"])(
  "propagates %s and cleans up heartbeat",
  async (kind) => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runStreamed.mockResolvedValue({
      events: (async function* () {
        if (kind === "throw") throw new Error("transport failed");
        if (kind === "error") yield { type: "error", message: "stream failed" };
        if (kind === "turn.failed")
          yield { type: "turn.failed", error: { message: "turn failed" } };
      })(),
    });
    await expect(
      runResumedCodex("thread", "Implement", "/workspace"),
    ).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  },
);
