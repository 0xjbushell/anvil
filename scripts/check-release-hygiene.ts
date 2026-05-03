#!/usr/bin/env bun
import { existsSync } from "node:fs";
import path from "node:path";

export interface TixItem {
  id: string;
  type: string;
  description: string;
  agentState: string;
  closeStatus?: string;
  parent?: string;
  tags: string[];
}

export interface ReleaseHygieneResult {
  ok: boolean;
  inspectedDeliverables: number;
  openDeliverables: TixItem[];
  parentRollups: TixItem[];
}

const shippedScopeTag = "release-readiness";
const completeState = "Done";
const executableType = "Deliverable";
const rollupTypes = new Set(["Story", "Feature"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function normalizeItem(value: unknown): TixItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = stringValue(value.id);
  const type = stringValue(value.type);
  const agentState = stringValue(value.agentState);
  if (!id || !type || !agentState) {
    return null;
  }

  const close = isRecord(value.close) ? value.close : undefined;

  return {
    id,
    type,
    description: stringValue(value.description) ?? "",
    agentState,
    closeStatus: stringValue(value.closeStatus) ?? stringValue(close?.status),
    parent: stringValue(value.parent),
    tags: stringArray(value.tags),
  };
}

export function parseTixPayload(payload: unknown): TixItem[] {
  if (!isRecord(payload)) {
    throw new Error("tix payload must be an object");
  }

  if (Array.isArray(payload.items)) {
    return payload.items.flatMap((entry) => {
      const item = normalizeItem(entry);
      return item ? [item] : [];
    });
  }

  if (isRecord(payload.lists)) {
    return Object.values(payload.lists).flatMap((list) => {
      if (!Array.isArray(list)) {
        return [];
      }

      return list.flatMap((entry) => {
        const item = normalizeItem(entry);
        return item ? [item] : [];
      });
    });
  }

  throw new Error("tix payload must contain items or lists");
}

export function analyzeReleaseHygiene(items: TixItem[]): ReleaseHygieneResult {
  const shippedScopeItems = items.filter((item) => item.tags.includes(shippedScopeTag));
  const deliverables = shippedScopeItems.filter((item) => item.type === executableType);
  const openDeliverables = deliverables.filter((item) => item.agentState !== completeState);
  const parentRollups = shippedScopeItems.filter(
    (item) => rollupTypes.has(item.type) && item.agentState !== completeState,
  );

  return {
    ok: openDeliverables.length === 0,
    inspectedDeliverables: deliverables.length,
    openDeliverables,
    parentRollups,
  };
}

function formatItem(item: TixItem): string {
  const close = item.closeStatus ? `, close: ${item.closeStatus}` : "";
  return `- ${item.id} (${item.type}, state: ${item.agentState}${close}): ${item.description}`;
}

export function formatReleaseHygieneReport(result: ReleaseHygieneResult): string {
  const lines: string[] = [];

  if (result.ok) {
    lines.push(
      `Release hygiene passed: ${result.inspectedDeliverables} shipped-scope deliverables are ${completeState}.`,
    );
  } else {
    lines.push("Release hygiene failed: shipped-scope executable deliverables are still open.");
    lines.push(...result.openDeliverables.map(formatItem));
  }

  if (result.parentRollups.length > 0) {
    lines.push("");
    lines.push(
      "Documented parent rollups: Story/Feature rollups may remain open while executable deliverables carry release status.",
    );
    lines.push(...result.parentRollups.map(formatItem));
  }

  return lines.join("\n");
}

function executablePath(command: string): string | null {
  for (const directory of process.env.PATH?.split(path.delimiter) ?? []) {
    const candidate = path.join(directory, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function loadTixItemsFromCli(): Promise<TixItem[]> {
  const tixPath = executablePath("tix");
  if (!tixPath) {
    throw new Error("tix CLI is not available on PATH");
  }

  const child = Bun.spawn([tixPath, "list", "--all", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`tix list --all --json failed: ${stderr.trim() || stdout.trim() || `exit ${exitCode}`}`);
  }

  return parseTixPayload(JSON.parse(stdout));
}

async function loadTixItemsFromJsonl(): Promise<TixItem[]> {
  const tixPath = path.resolve(import.meta.dir, "..", ".tix", "tasks.jsonl");
  const text = await Bun.file(tixPath).text();

  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const item = normalizeItem(JSON.parse(line));
      return item ? [item] : [];
    });
}

async function loadTixItems(): Promise<{ source: string; items: TixItem[] }> {
  if (executablePath("tix")) {
    return { source: "tix list --all --json", items: await loadTixItemsFromCli() };
  }

  return { source: ".tix/tasks.jsonl read-only fallback", items: await loadTixItemsFromJsonl() };
}

async function main(): Promise<number> {
  const { source, items } = await loadTixItems();
  const result = analyzeReleaseHygiene(items);

  console.log(`Release hygiene source: ${source}`);
  console.log(formatReleaseHygieneReport(result));

  return result.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await main();
}
