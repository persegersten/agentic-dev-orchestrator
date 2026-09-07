import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import pino from "pino";
import { z } from "zod";

import { runCodex as runCodexReadOnly } from "../codex/runCodex.js";
import { planChange, type PlannerResult } from "../workflow/planner.js";
import { createTask, loadTask, saveTask, deleteTask } from "../workflow/task-store.js";
import { transition } from "../workflow/task.js";
import { executeApprovedTask } from "../workflow/execute-task.js";

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

  switch (command) {
  case "create":
    await handleCreate(input.workspace, args);
    break;

  case "plan":
    await handlePlan(input.workspace, args);
    break;

  case "approve":
    await approvePlan(input.workspace, args);
    break;

  case "delete":
    await deletePlan(input.workspace, args);
    break;
    
  case "implement":
    throw new Error("Use approve <task-id> to explicitly approve and execute the complete task lifecycle.");

  default:
    throw new Error(`Unknown command: ${command}`);

  }
}

async function handleCreate(workspace: string, args: string[]) {
  const instruction = args.join(" ");

  if (!instruction) {
    throw new Error("Instruction is required");
  }

  const task = await createTask(instruction);

  console.log(`Task created: ${task.id}`);
  console.log(`State: ${task.state}`);
}

async function deletePlan(workspace: string, args: string[]) {
  const taskId = args[0];

  if (!taskId) {
    throw new Error("Task id is required");
  }

  const task = await loadTask(taskId);
  await deleteTask(task);

  console.log(`Task canceled: ${task.id}`);
}



async function approvePlan(workspace: string, args: string[]) {
  const taskId = args[0];

  if (!taskId) {
    throw new Error("Task id is required");
  }

  const task = await executeApprovedTask(taskId, workspace);

  console.log(`Task completed: ${task.id}`);
  console.log(`Branch: ${task.branchName}`);
  console.log(`Commit: ${task.commitSha}`);
  console.log(`Pull request: ${task.pullRequestUrl}`);
  console.log(`State: ${task.state}`);
}

async function handlePlan(workspace: string, args: string[]) {
  const taskId = args[0];

  if (!taskId) {
    throw new Error("Task id is required");
  }

  let task = await loadTask(taskId);

  if (task.state !== "RECEIVED") {
    throw new Error(
      `Task ${task.id} cannot be planned from state ${task.state}`
    );
  }

  // 1. Markera att planning har startat
  task = transition(task, "PLANNING");
  await saveTask(task);

  try {
    console.log(`Starting Codex thread for task: ${task.id}`);

    const result = await runPlanner(task.instruction, workspace);

    // 4. Spara threadId + validerad plan
    task = {
      ...task,
      threadId: result.threadId,
      plan: result.response,
    };

    // 6. Planning är klar, invänta mänskligt godkännande
    task = transition(task, "AWAITING_APPROVAL");

    await saveTask(task);

    console.log(`Thread ID: ${task.threadId}`);
    console.log(`Task: ${task.id}`);
    console.log(`State: ${task.state}`);
    console.log(JSON.stringify(task.plan, null, 2));

  } catch (error) {
    // 7. Planning misslyckades
    task = transition(task, "FAILED");
    await saveTask(task);

    throw error;
  }
}

async function runPlanner(
  issue: string,
  workspace: string,
): Promise<PlannerResult> {
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

  const result = await planChange(issue, workspace);

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
  console.log(JSON.stringify(result.response, null, 2));
  console.log();
  console.log("--------------------------");

  return result;
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
    const result = await runCodexReadOnly(
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
