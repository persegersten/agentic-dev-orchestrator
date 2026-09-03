import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface ValidationResult {
  success: boolean;
  output: string;
}

export async function validateWorkspace(
  workspace: string,
): Promise<ValidationResult> {
  const command = "./mvnw test";
  const cwd = `${workspace}/backend`;

  console.log(
    `Starting validation: command=${JSON.stringify(command)} cwd=${JSON.stringify(cwd)}`,
  );

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
    });

    return {
      success: true,
      output: stdout + stderr,
    };
  } catch (error: unknown) {
    const commandError = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const commandOutput =
      (commandError.stdout ?? "") + (commandError.stderr ?? "");

    return {
      success: false,
      output: commandOutput || commandError.message || String(error),
    };
  }
}
