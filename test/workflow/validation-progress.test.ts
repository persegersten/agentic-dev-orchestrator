import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  ...mocks,
}));
import { validateWorkspace } from "../../src/workflow/validator.js";

afterEach(() => vi.restoreAllMocks());

it("shows both output streams before process completion and preserves their contents", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  mocks.spawn.mockReturnValue(child);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let completed = false;
  const result = validateWorkspace("/workspace").then((value) => {
    completed = true;
    return value;
  });
  await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());
  child.stdout.write("Tests starting\n");
  child.stderr.write("Docker unavailable\n");
  expect(log).toHaveBeenCalledWith("[VALIDATING] Tests starting");
  expect(log).toHaveBeenCalledWith("[VALIDATING] Docker unavailable");
  expect(completed).toBe(false);
  child.stdout.end();
  child.stderr.end();
  child.emit("close", 1, null);
  expect(await result).toEqual({
    success: false,
    output: "Tests starting\nDocker unavailable\n",
  });
});
