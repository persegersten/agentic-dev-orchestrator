import { afterEach, expect, it, vi } from "vitest";
import { startProgress } from "../../src/workflow/progress.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("reports quiet periods, resets after output, and stops its timer", () => {
  vi.useFakeTimers();
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const progress = startProgress("Codex implementation");
  vi.advanceTimersByTime(19_000);
  expect(log).not.toHaveBeenCalled();
  progress.report("Command started");
  vi.advanceTimersByTime(19_000);
  expect(log).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(log).toHaveBeenLastCalledWith(
    "[Codex implementation] Still waiting — elapsed 39s",
  );
  progress.stop();
  expect(vi.getTimerCount()).toBe(0);
});
