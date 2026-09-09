import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { startProgress } from "./progress.js";

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
