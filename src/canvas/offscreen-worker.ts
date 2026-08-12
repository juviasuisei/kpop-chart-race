/**
 * OffscreenCanvas rendering worker.
 *
 * Receives an OffscreenCanvas via transferable and draws line commands
 * sent from the main thread. This keeps all background layer painting
 * completely off the main thread.
 */

import type { LineDrawCommand } from "../worker/messages.ts";
import type { OffscreenWorkerMessage } from "./offscreen-renderer.ts";

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let currentDpr = 1;

/**
 * Draw line commands onto the OffscreenCanvas.
 */
function drawCommands(commands: LineDrawCommand[]): void {
  if (!ctx || !canvas) return;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const cmd of commands) {
    if (cmd.points.length < 2 || cmd.opacity <= 0) continue;

    ctx.beginPath();
    ctx.moveTo(cmd.points[0].x, cmd.points[0].y);
    for (let i = 1; i < cmd.points.length; i++) {
      ctx.lineTo(cmd.points[i].x, cmd.points[i].y);
    }
    ctx.strokeStyle = cmd.color;
    ctx.globalAlpha = cmd.opacity;
    ctx.lineWidth = cmd.lineWidth;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/**
 * Clear the entire canvas.
 */
function clearCanvas(): void {
  if (!ctx || !canvas) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/**
 * Resize the canvas and update the DPR transform.
 */
function resizeCanvas(width: number, height: number, dpr: number): void {
  if (!canvas || !ctx) return;
  currentDpr = dpr;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// --- Message handler ---

interface InitMessage {
  type: "init";
  canvas: OffscreenCanvas;
}

type WorkerMessage = InitMessage | OffscreenWorkerMessage;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case "init": {
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      }
      break;
    }

    case "resize": {
      resizeCanvas(msg.width, msg.height, msg.dpr);
      break;
    }

    case "draw": {
      clearCanvas();
      if (msg.dpr !== currentDpr || !canvas ||
          canvas.width !== msg.width * msg.dpr ||
          canvas.height !== msg.height * msg.dpr) {
        resizeCanvas(msg.width, msg.height, msg.dpr);
      }
      drawCommands(msg.commands);
      break;
    }

    case "clear": {
      clearCanvas();
      break;
    }
  }
};
