import fs from "node:fs";
import path from "node:path";
import type { RfmReviewIndexSummary } from "@roughdraft/rfm";

export interface ReviewCompletedEventInput {
  documentPath: string;
  projectPath: string;
  relativePath: string;
  version: string;
  summary: RfmReviewIndexSummary;
  overallComment?: string;
}

export interface ReviewCompletedEvent extends ReviewCompletedEventInput {
  type: "review.completed";
  sequence: number;
  createdAt: string;
}

export interface WaitForReviewEventsOptions {
  documentPath?: string;
  afterSequence?: number;
  timeoutMs?: number;
  batchWindowMs?: number;
}

export interface WaitForReviewEventsResult {
  events: ReviewCompletedEvent[];
  timedOut: boolean;
  nextSequence: number;
}

interface Waiter {
  options: NormalizedWaitOptions;
  resolve: (result: WaitForReviewEventsResult) => void;
  timeout: NodeJS.Timeout | null;
  batchTimeout: NodeJS.Timeout | null;
}

const DEFAULT_BATCH_WINDOW_MS = 250;
const MAX_RETAINED_EVENTS = 100;

type NormalizedWaitOptions = Required<
  Omit<WaitForReviewEventsOptions, "documentPath" | "timeoutMs">
> & {
  documentPath?: string;
  timeoutMs?: number;
};

export class ReviewEventQueue {
  private events: ReviewCompletedEvent[] = [];
  private waiters = new Set<Waiter>();
  private nextSequence = 1;

  emit(input: ReviewCompletedEventInput): {
    delivered: boolean;
    event: ReviewCompletedEvent;
  } {
    const event: ReviewCompletedEvent = {
      ...input,
      type: "review.completed",
      sequence: this.nextSequence,
      createdAt: new Date().toISOString(),
    };
    this.nextSequence += 1;
    this.events.push(event);
    this.events = this.events.slice(-MAX_RETAINED_EVENTS);

    appendSlog("review-events.emit", {
      documentPath: event.documentPath,
      sequence: event.sequence,
      waiters: this.waiters.size,
      hasOverallComment: typeof event.overallComment === "string",
      overallCommentLength: event.overallComment?.length ?? 0,
    });

    let delivered = false;
    for (const waiter of [...this.waiters]) {
      if (matchesWaiter(event, waiter.options)) {
        delivered = true;
        this.scheduleResolve(waiter);
      }
    }

    return { delivered, event };
  }

  wait(
    options: WaitForReviewEventsOptions = {},
  ): Promise<WaitForReviewEventsResult> {
    const normalized = normalizeWaitOptions(options);
    const existing = this.matchingEvents(normalized);

    if (existing.length > 0) {
      return Promise.resolve(
        resultForEvents(existing, false, this.nextSequence),
      );
    }

    return new Promise((resolve) => {
      const waiter: Waiter = {
        options: normalized,
        resolve,
        batchTimeout: null,
        timeout:
          normalized.timeoutMs !== undefined
            ? setTimeout(() => {
                this.resolveWaiter(waiter, true);
              }, normalized.timeoutMs)
            : null,
      };

      this.waiters.add(waiter);
      appendSlog("review-events.wait", {
        documentPath: normalized.documentPath ?? null,
        afterSequence: normalized.afterSequence,
        timeoutMs: normalized.timeoutMs,
      });
    });
  }

  waiterCount(): number {
    return this.waiters.size;
  }

  latestSequence(): number {
    return this.nextSequence - 1;
  }

  waiterCountForDocument(documentPath: string): number {
    const normalizedPath = path.resolve(documentPath);
    return [...this.waiters].filter(
      (waiter) => waiter.options.documentPath === normalizedPath,
    ).length;
  }

  private matchingEvents(
    options: NormalizedWaitOptions,
  ): ReviewCompletedEvent[] {
    return this.events.filter((event) => matchesWaiter(event, options));
  }

  private scheduleResolve(waiter: Waiter): void {
    if (waiter.batchTimeout) return;

    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
      waiter.timeout = null;
    }

    waiter.batchTimeout = setTimeout(() => {
      this.resolveWaiter(waiter, false);
    }, waiter.options.batchWindowMs);
  }

  private resolveWaiter(waiter: Waiter, timedOut: boolean): void {
    if (!this.waiters.has(waiter)) return;

    this.waiters.delete(waiter);
    if (waiter.timeout) {
      clearTimeout(waiter.timeout);
    }
    if (waiter.batchTimeout) {
      clearTimeout(waiter.batchTimeout);
    }

    const events = timedOut ? [] : this.matchingEvents(waiter.options);
    waiter.resolve(resultForEvents(events, timedOut, this.nextSequence));
  }
}

function normalizeWaitOptions(
  options: WaitForReviewEventsOptions,
): NormalizedWaitOptions {
  return {
    documentPath: options.documentPath
      ? path.resolve(options.documentPath)
      : undefined,
    afterSequence: Math.max(0, options.afterSequence ?? 0),
    timeoutMs:
      options.timeoutMs !== undefined
        ? clamp(options.timeoutMs, 0, 300_000)
        : undefined,
    batchWindowMs: clamp(
      options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS,
      0,
      10_000,
    ),
  };
}

function matchesWaiter(
  event: ReviewCompletedEvent,
  options: NormalizedWaitOptions,
): boolean {
  if (event.sequence <= options.afterSequence) return false;
  if (!options.documentPath) return true;
  return path.resolve(event.documentPath) === options.documentPath;
}

function resultForEvents(
  events: ReviewCompletedEvent[],
  timedOut: boolean,
  nextSequence: number,
): WaitForReviewEventsResult {
  return {
    events,
    timedOut,
    nextSequence,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function appendSlog(event: string, data: Record<string, unknown>): void {
  const file = process.env.THOUGHTFUL_SLOG_FILE;
  if (!file) return;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      runId: process.env.THOUGHTFUL_SLOG_RUN_ID ?? "manual",
      source: "packages/server/src/review-events.ts",
      event,
      data,
    })}\n`,
  );
}
