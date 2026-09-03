import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateWorkspace } from "../../src/workflow/validator.js";

async function createWorkspace(script: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "validator-test-"));
  const backend = join(workspace, "backend");
  const wrapper = join(backend, "mvnw");

  await mkdir(backend);
  await writeFile(wrapper, script, "utf8");
  await chmod(wrapper, 0o755);

  return workspace;
}

describe("validateWorkspace", () => {
  it("runs the Maven wrapper from the backend directory", async () => {
    const workspace = await createWorkspace(
      "#!/bin/sh\nprintf '%s' \"$PWD\"\n",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await validateWorkspace(workspace);

    expect(log).toHaveBeenCalledWith(
      `Starting validation: command="./mvnw test" cwd=${JSON.stringify(join(workspace, "backend"))}`,
    );
    expect(result).toEqual({
      success: true,
      output: join(workspace, "backend"),
    });

    log.mockRestore();
  });

  it("preserves stderr when the validation command fails", async () => {
    const workspace = await createWorkspace(
      "#!/bin/sh\necho 'test failure details' >&2\nexit 1\n",
    );

    const result = await validateWorkspace(workspace);

    expect(result.success).toBe(false);
    expect(result.output).toContain("test failure details");
  });
});
