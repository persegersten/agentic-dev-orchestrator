import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { startProgress } from "./progress.js";

const runCommand = promisify(execFile);

async function checkDocker(cwd: string): Promise<string | undefined> {
  let pom: string;
  try {
    pom = await readFile(`${cwd}/pom.xml`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!/\borg\.testcontainers\b/.test(pom.replace(/<!--[\s\S]*?-->/g, "")))
    return;

  try {
    await runCommand("docker", ["info"], { cwd, timeout: 15_000 });
  } catch (error) {
    return [
      "Docker preflight failed: this backend declares Testcontainers dependencies, but Docker is unavailable. Maven tests were not started.",
      "Start Docker and verify that 'docker info' works in the same environment as the orchestrator.",
      "On Windows/WSL, enable Docker Desktop > Settings > Resources > WSL Integration for your distribution and apply the settings.",
      "If Docker uses a custom socket, set DOCKER_HOST for the orchestrator and Testcontainers.",
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }
}

export interface ValidationResult {
  success: boolean;
  output: string;
}

export async function validateWorkspace(
  workspace: string,
): Promise<ValidationResult> {
  const cwd = `${workspace}/backend`;
  const progress = startProgress("VALIDATING");
  progress.report(
    `Starting validation: command="./mvnw test" cwd=${JSON.stringify(cwd)}`,
  );
  let stdout = "";
  let stderr = "";
  try {
    const dockerFailure = await checkDocker(cwd);
    if (dockerFailure) {
      progress.report(dockerFailure);
      return { success: false, output: dockerFailure };
    }
    return await new Promise<ValidationResult>((resolve) => {
      const child = spawn("./mvnw", ["test"], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      const lines = [child.stdout, child.stderr].map((stream) =>
        createInterface({ input: stream, crlfDelay: Infinity }),
      );
      for (const reader of lines)
        reader.on("line", (line) => progress.report(line));
      let error: Error | undefined;
      child.on("error", (cause) => {
        error = cause;
      });
      child.on("close", (code, signal) => {
        for (const reader of lines) reader.close();
        const success = !error && code === 0;
        progress.report(
          success
            ? "Tests passed"
            : `Tests failed (${error?.message ?? signal ?? `exit ${code}`})`,
        );
        resolve({
          success,
          output:
            stdout + stderr ||
            error?.message ||
            (success ? "" : `Validation exited with ${signal ?? code}`),
        });
      });
    });
  } finally {
    progress.stop();
  }
}
