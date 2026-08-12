/**
 * Typed message definitions for communication between the main thread
 * and the chart computation Web Worker.
 *
 * Messages flow in two directions:
 *   Main → Worker: requests (compute frame, update viewport, load data)
 *   Worker → Main: responses (frame data, geometry, status updates)
 *
 * Each message has a discriminated `type` field for safe narrowing.
 */

// --- Shared geometry types ---

/** A single point in pixel space for drawing */
export interface PixelPoint {
  x: number;
  y: number;
}

/** Draw command for a single line segment */
export interface LineDrawCommand {
  lineId: string;
  points: PixelPoint[];
  /** Cumulative value at each point (parallel to points[]) */
  values: number[];
  color: string;
  opacity: number;
  lineWidth: number;
}

/** Which canvas layer a line belongs to */
export type CanvasLayer = "background" | "foreground" | "highlight";

/** Viewport bounds (pixel space) */
export interface Viewport {
  /** Start date index (inclusive) */
  startDateIndex: number;
  /** End date index (inclusive, integer — the last fully revealed date) */
  endDateIndex: number;
  /** Fractional progress toward the NEXT date (0.0 = just arrived at endDateIndex, 1.0 = about to reach endDateIndex+1) */
  progressToNext: number;
  /** Canvas pixel width */
  width: number;
  /** Canvas pixel height */
  height: number;
  /** Device pixel ratio */
  dpr: number;
}

/** Visibility parameters passed to the worker for dimming computation */
export interface VisibilityParams {
  /** Number of active non-default filters (affects ceiling) */
  filterCount: number;
  /** Whether a specific artist filter is active (override: always visible) */
  artistFilterActive: boolean;
  /** Currently selected line IDs (rendered on highlight layer) */
  selectedLineIds: string[];
}

// --- Main → Worker messages ---

/** Initialize the worker with data */
export interface InitDataMessage {
  type: "init-data";
  /** Serialized sparse time series data per line */
  lines: SerializedLineData[];
  /** All available dates sorted chronologically */
  dates: string[];
}

/** Serialized line data for transfer to worker */
export interface SerializedLineData {
  lineId: string;
  /** Artist display name (for labels/tooltips) */
  label: string;
  /** Color hex string */
  color: string;
  /** Change-point entries: [dateIndex, cumulativeValue][] */
  changePoints: [number, number][];
}

/** Request a computed frame for a given date */
export interface ComputeFrameMessage {
  type: "compute-frame";
  /** Request ID for correlating responses */
  requestId: number;
  /** The current animation date index */
  currentDateIndex: number;
  /** Viewport for coordinate mapping */
  viewport: Viewport;
  /** Visibility/dimming parameters */
  visibility: VisibilityParams;
}

/** Update viewport without recomputing all visibility */
export interface UpdateViewportMessage {
  type: "update-viewport";
  requestId: number;
  viewport: Viewport;
}

/** Notify worker of selection changes */
export interface SelectionChangeMessage {
  type: "selection-change";
  selectedLineIds: string[];
}

// --- Worker → Main messages ---

/** Frame computation result */
export interface FrameResultMessage {
  type: "frame-result";
  requestId: number;
  /** Lines grouped by canvas layer, already sorted by z-index */
  background: LineDrawCommand[];
  foreground: LineDrawCommand[];
  highlight: LineDrawCommand[];
  /** Total lines processed (for diagnostics) */
  totalLines: number;
  /** Computation time in ms */
  computeTimeMs: number;
}

/** Worker is ready to accept commands */
export interface WorkerReadyMessage {
  type: "worker-ready";
}

/** Worker encountered an error */
export interface WorkerErrorMessage {
  type: "worker-error";
  error: string;
}

// --- Union types ---

/** All messages sent from main thread to worker */
export type MainToWorkerMessage =
  | InitDataMessage
  | ComputeFrameMessage
  | UpdateViewportMessage
  | SelectionChangeMessage;

/** All messages sent from worker to main thread */
export type WorkerToMainMessage =
  | FrameResultMessage
  | WorkerReadyMessage
  | WorkerErrorMessage;
