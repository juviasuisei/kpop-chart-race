/**
 * Main-thread client for communicating with the chart computation Web Worker.
 *
 * Provides a promise-based API over the postMessage interface, handles
 * request/response correlation, and manages the worker lifecycle.
 */

import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  FrameResultMessage,
  SerializedLineData,
  Viewport,
  VisibilityParams,
} from "./messages.ts";

/** Callback for frame results (used in streaming mode instead of promises) */
export type FrameCallback = (result: FrameResultMessage) => void;

/**
 * Client wrapper for the chart computation Web Worker.
 * Handles typed message passing, request correlation, and lifecycle.
 */
export class ChartWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (msg: WorkerToMainMessage) => void;
    reject: (err: Error) => void;
  }>();
  private frameCallback: FrameCallback | null = null;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  /**
   * Create and start the Web Worker.
   * Returns a promise that resolves when the worker signals ready.
   */
  async init(): Promise<void> {
    if (this.worker) return this.readyPromise ?? Promise.resolve();

    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    // Vite handles the Worker URL via import.meta.url
    this.worker = new Worker(
      new URL("./chart-worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleError;

    return this.readyPromise;
  }

  /**
   * Send line data to the worker for initialization.
   * Resolves when the worker signals ready after processing.
   */
  async initData(lines: SerializedLineData[], dates: string[]): Promise<void> {
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });

    this.post({ type: "init-data", lines, dates });
    return this.readyPromise;
  }

  /**
   * Request a frame computation. Returns the frame result.
   */
  async computeFrame(
    currentDateIndex: number,
    viewport: Viewport,
    visibility: VisibilityParams,
  ): Promise<FrameResultMessage> {
    const requestId = this.nextRequestId++;
    this.post({
      type: "compute-frame",
      requestId,
      currentDateIndex,
      viewport,
      visibility,
    });

    return this.awaitResponse(requestId) as Promise<FrameResultMessage>;
  }

  /**
   * Register a callback for streaming frame results.
   * When set, frame results are delivered via callback instead of promises.
   * This avoids promise overhead in the animation loop.
   */
  onFrame(callback: FrameCallback | null): void {
    this.frameCallback = callback;
  }

  /**
   * Fire-and-forget frame request (result delivered via onFrame callback).
   * Returns the request ID for cancellation/deduplication.
   */
  requestFrame(
    currentDateIndex: number,
    viewport: Viewport,
    visibility: VisibilityParams,
  ): number {
    const requestId = this.nextRequestId++;
    this.post({
      type: "compute-frame",
      requestId,
      currentDateIndex,
      viewport,
      visibility,
    });
    return requestId;
  }

  /**
   * Notify the worker of selection changes.
   */
  setSelection(lineIds: string[]): void {
    this.post({ type: "selection-change", selectedLineIds: lineIds });
  }

  /**
   * Terminate the worker and clean up.
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Reject all pending requests
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error("Worker terminated"));
    }
    this.pendingRequests.clear();
    this.frameCallback = null;
  }

  // --- Private ---

  private post(msg: MainToWorkerMessage): void {
    if (!this.worker) {
      throw new Error("ChartWorkerClient: worker not initialized. Call init() first.");
    }
    this.worker.postMessage(msg);
  }

  private awaitResponse(requestId: number): Promise<WorkerToMainMessage> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });
    });
  }

  private handleMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
    const msg = event.data;

    switch (msg.type) {
      case "worker-ready": {
        if (this.readyResolve) {
          this.readyResolve();
          this.readyResolve = null;
        }
        break;
      }

      case "frame-result": {
        // Streaming callback takes priority over promise resolution
        if (this.frameCallback) {
          this.frameCallback(msg);
        }

        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg);
        }
        break;
      }

      case "worker-error": {
        console.error("[ChartWorkerClient] Worker error:", msg.error);
        // Reject all pending requests on error
        for (const [, { reject }] of this.pendingRequests) {
          reject(new Error(msg.error));
        }
        this.pendingRequests.clear();
        break;
      }
    }
  };

  private handleError = (event: ErrorEvent): void => {
    console.error("[ChartWorkerClient] Worker uncaught error:", event.message);
    for (const [, { reject }] of this.pendingRequests) {
      reject(new Error(event.message));
    }
    this.pendingRequests.clear();
  };
}
