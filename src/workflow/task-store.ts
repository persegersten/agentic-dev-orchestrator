import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { Task } from "./task.js";

const TASK_DIR = ".agent/tasks";

export async function createTask(
  instruction: string
): Promise<Task> {
  const now = new Date().toISOString();

  const task: Task = {
    id: crypto.randomUUID(),
    instruction,
    state: "RECEIVED",
    createdAt: now,
    updatedAt: now,
  };

  await saveTask(task);

  return task;
}

export async function saveTask(task: Task): Promise<void> {
  await mkdir(TASK_DIR, { recursive: true });

  const file = path.join(TASK_DIR, `${task.id}.json`);

  await writeFile(
    file,
    JSON.stringify(task, null, 2),
    "utf-8"
  );
}

export async function loadTask(id: string): Promise<Task> {
  const file = path.join(TASK_DIR, `${id}.json`);

  const json = await readFile(file, "utf-8");

  return JSON.parse(json) as Task;
}

export async function deleteTask(task: Task): Promise<void> {
  const file = path.join(TASK_DIR, `${task.id}.json`);

  await unlink(file);
}
