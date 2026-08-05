import { Codex } from "@openai/codex-sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pino from "pino";
import { z } from "zod";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const inputSchema = z.object({
  instruction: z.string().trim().min(1, "En instruktion måste anges."),
  workspace: z.string().trim().min(1),
});

async function main(): Promise<void> {
  const input = inputSchema.parse({
    instruction: process.argv.slice(2).join(" "),
    workspace: resolve(
      process.env.AGENT_WORKSPACE ?? "../agentic-spring-lab",
    ),
  });

  // Detta är orchestratorns eget körnings-ID.
  const runId = randomUUID();
  const startedAt = new Date();

  logger.info(
    {
      runId,
      startedAt: startedAt.toISOString(),
      workspace: input.workspace,
      instruction: input.instruction,
    },
    "Codex run started",
  );

  const codex = new Codex();

  const thread = codex.startThread({
    workingDirectory: input.workspace,

    // Första uppgiften är bara analys.
    sandboxMode: "read-only",

    // CLI-programmet ska inte fastna och vänta på interaktivt godkännande.
    approvalPolicy: "never",
  });

  try {
    const result = await thread.run(input.instruction);
    const endedAt = new Date();

    if (!thread.id) {
      throw new Error("Codex returned no thread ID.");
    }

    const metadata = {
      runId,
      threadId: thread.id,
      instruction: input.instruction,
      workspace: input.workspace,
      status: "completed",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      usage: result.usage,
    };

    const metadataDirectory = resolve(".agent-runs");
    await mkdir(metadataDirectory, { recursive: true });

    await writeFile(
      resolve(metadataDirectory, `${runId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );

    logger.info(metadata, "Codex run completed");

    console.log();
    console.log("----- Codex result -----");
    console.log();
    console.log(result.finalResponse);
    console.log();
    console.log("------------------------");
    console.log(`run-id:    ${runId}`);
    console.log(`thread-id: ${thread.id}`);
  } catch (error) {
    const endedAt = new Date();

    logger.error(
      {
        runId,
        threadId: thread.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        error,
      },
      "Codex run failed",
    );

    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof z.ZodError) {
    console.error("Felaktiga argument:", error.issues);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});