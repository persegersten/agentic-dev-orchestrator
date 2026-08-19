import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pino from "pino";
import { z } from "zod";

import { runCodex } from "../codex/runCodex.js";
import { planChange } from "../workflow/planner.js";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const inputSchema = z.object({
  command: z.string().trim().min(1, "Ett kommando eller en instruktion måste anges."),
  arguments: z.array(z.string()),
  workspace: z.string().trim().min(1),
});

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  const input = inputSchema.parse({
    command,
    arguments: args,
    workspace: resolve(
      process.env.AGENT_WORKSPACE ?? "../agentic-spring-lab",
    ),
  });

  if (input.command === "plan") {
    await runPlanner(input.arguments, input.workspace);
    return;
  }

  await runGeneralAgent(
    [input.command, ...input.arguments].join(" "),
    input.workspace,
  );
}

async function runPlanner(
  args: string[],
  workspace: string,
): Promise<void> {
  const issue = args.join(" ").trim();

  if (!issue) {
    throw new Error(
      'Planner kräver ett ärende, exempelvis: plan "Add reverse movement to vehicles"',
    );
  }

  logger.info(
    {
      workspace,
      issue,
    },
    "Planner started",
  );

  const plan = await planChange(issue, workspace);

  logger.info(
    {
      workspace,
      issue,
    },
    "Planner completed",
  );

  console.log();
  console.log("----- Planner result -----");
  console.log();
  console.log(JSON.stringify(plan, null, 2));
  console.log();
  console.log("--------------------------");
}

async function runGeneralAgent(
  instruction: string,
  workspace: string,
): Promise<void> {
  const runId = randomUUID();
  const startedAt = new Date();

  let threadId: string | undefined;

  logger.info(
    {
      runId,
      startedAt: startedAt.toISOString(),
      workspace,
      instruction,
    },
    "Codex run started",
  );

  try {
    const result = await runCodex(
      instruction,
      workspace,
    );

    threadId = result.threadId;

    const endedAt = new Date();

    const metadata = {
      runId,
      threadId: result.threadId,
      instruction,
      workspace,
      status: "completed",
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationMs: endedAt.getTime() - startedAt.getTime(),
      usage: result.usage,
    };

    const metadataDirectory = resolve(".agent-runs");

    await mkdir(metadataDirectory, {
      recursive: true,
    });

    await writeFile(
      resolve(metadataDirectory, `${runId}.json`),
      JSON.stringify(metadata, null, 2),
      "utf8",
    );

    logger.info(
      metadata,
      "Codex run completed",
    );

    console.log();
    console.log("----- Codex result -----");
    console.log();
    console.log(result.finalResponse);
    console.log();
    console.log("------------------------");
    console.log(`run-id:    ${runId}`);
    console.log(`thread-id: ${result.threadId}`);
  } catch (error) {
    const endedAt = new Date();

    logger.error(
      {
        runId,
        threadId,
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
    console.error(
      "Felaktiga argument:",
      error.issues,
    );
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});