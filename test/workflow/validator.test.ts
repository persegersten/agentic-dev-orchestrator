import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validateWorkspace } from "../../src/workflow/validator.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function configureDocker(workspace: string, script: string) {
  const backend = join(workspace, "backend");
  await writeFile(
    join(backend, "pom.xml"),
    "<project><dependencies><dependency><groupId>org.testcontainers</groupId></dependency></dependencies></project>",
  );
  const bin = join(workspace, "bin");
  await mkdir(bin);
  await writeFile(join(bin, "docker"), script);
  await chmod(join(bin, "docker"), 0o755);
  vi.stubEnv("PATH", bin);
}

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
  it("stops before Maven and explains WSL integration when Docker is unavailable", async () => {
    const workspace = await createWorkspace("#!/bin/sh\necho MAVEN_STARTED\n");
    await configureDocker(
      workspace,
      "#!/bin/sh\necho 'daemon unavailable' >&2\nexit 1\n",
    );

    const result = await validateWorkspace(workspace);

    expect(result.success).toBe(false);
    expect(result.output).toContain("WSL Integration");
    expect(result.output).toContain("daemon unavailable");
    expect(result.output).not.toContain("MAVEN_STARTED");
  });

  it("runs Maven when Docker is available", async () => {
    const workspace = await createWorkspace("#!/bin/sh\necho MAVEN_STARTED\n");
    await configureDocker(workspace, '#!/bin/sh\n[ "$1" = info ]\n');

    expect(await validateWorkspace(workspace)).toEqual({
      success: true,
      output: "MAVEN_STARTED\n",
    });
  });

  it("does not require Docker for a backend without Testcontainers dependencies", async () => {
    const workspace = await createWorkspace("#!/bin/sh\necho MAVEN_STARTED\n");
    await writeFile(join(workspace, "backend", "pom.xml"), "<project/>");
    vi.stubEnv("PATH", workspace);

    expect((await validateWorkspace(workspace)).success).toBe(true);
  });

  it("reports a missing Docker executable clearly", async () => {
    const workspace = await createWorkspace("#!/bin/sh\necho MAVEN_STARTED\n");
    await configureDocker(workspace, "#!/bin/sh\nexit 0\n");
    vi.stubEnv("PATH", join(workspace, "missing-bin"));

    const result = await validateWorkspace(workspace);
    expect(result.success).toBe(false);
    expect(result.output).toContain("ENOENT");
    expect(result.output).toContain("Maven tests were not started");
  });

  it("runs the Maven wrapper from the backend directory", async () => {
    const workspace = await createWorkspace(
      "#!/bin/sh\nprintf '%s' \"$PWD\"\n",
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await validateWorkspace(workspace);

    expect(log).toHaveBeenCalledWith(
      `[VALIDATING] Starting validation: command="./mvnw test" cwd=${JSON.stringify(join(workspace, "backend"))}`,
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
