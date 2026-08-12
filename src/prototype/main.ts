/**
 * Phase 0 Visual Prototype — Main entry point.
 * 
 * Renders a static frame demonstrating:
 * - 3-layer canvas (background, foreground, highlight)
 * - Dimming based on days since activity (7-day grace, fade to 28)
 * - Z-index: recency primary, LTD points tie-break
 * - Highlight: click line → others dim ×0.2, selected triples thickness
 * - Event dots with priority shapes
 * - Hover tooltip & disambiguation popup for clusters
 * - Popover on event dot click
 */

import { PROTOTYPE_LINES, type PrototypeLine, type PrototypeEvent, SOURCE_LABELS, SOURCE_LOGOS } from "./data.ts";

// --- Constants ---
const FADE_START = 7;
const FADE_END = 28;
const BASE_LINE_WIDTH = 1.5;
const HIGHLIGHT_MULTIPLIER = 3;
const DIM_MULTIPLIER = 0.2;
const HIT_RADIUS = 8;
const PADDING = { top: 40, right: 160, bottom: 40, left: 0 };

// --- State ---
let selectedLineId: string | null = null;
let popoverOpen = false; // true when popover is showing (click-to-engage)

// --- DOM refs ---
const container = document.getElementById("container")!;
const bgCanvas = document.getElementById("bg-canvas") as HTMLCanvasElement;
const fgCanvas = document.getElementById("fg-canvas") as HTMLCanvasElement;
const hlCanvas = document.getElementById("hl-canvas") as HTMLCanvasElement;
const tooltip = document.getElementById("tooltip")!;
const disambiguation = document.getElementById("disambiguation")!;
const popover = document.getElementById("popover")!;

// --- Canvas setup ---
function setupCanvases() {
  const rect = container.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;

  for (const canvas of [bgCanvas, fgCanvas, hlCanvas]) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
  }

  return { width: w, height: h };
}

// --- Visibility computation ---
function computeOpacity(daysSinceActivity: number): number {
  if (daysSinceActivity <= FADE_START) return 1.0;
  if (daysSinceActivity >= FADE_END) return 0.0;
  return 1.0 - (daysSinceActivity - FADE_START) / (FADE_END - FADE_START);
}

function computeZIndex(daysSinceActivity: number, ltdPoints: number): number {
  return (36500 - daysSinceActivity) * 1_000_000_000 + ltdPoints;
}

// --- Coordinate mapping ---
function getChartArea(width: number, height: number) {
  return {
    x: PADDING.left,
    y: PADDING.top,
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  };
}

function getMaxValue(): number {
  let max = 0;
  for (const line of PROTOTYPE_LINES) {
    const lineMax = line.values[line.values.length - 1] ?? 0;
    if (lineMax > max) max = lineMax;
  }
  return max;
}

function valueToY(value: number, maxValue: number, chart: { y: number; h: number }): number {
  return chart.y + chart.h - (value / maxValue) * chart.h;
}

function indexToX(index: number, totalPoints: number, chart: { x: number; w: number }): number {
  return chart.x + (index / (totalPoints - 1)) * chart.w;
}

// --- Line path building ---
interface LineRenderData {
  line: PrototypeLine;
  opacity: number;
  zIndex: number;
  path: { x: number; y: number }[];
}

function buildRenderData(width: number, height: number): LineRenderData[] {
  const chart = getChartArea(width, height);
  const maxValue = getMaxValue();
  const totalPoints = 90;

  const renderData: LineRenderData[] = [];

  for (const line of PROTOTYPE_LINES) {
    const opacity = computeOpacity(line.daysSinceActivity);
    if (opacity <= 0) continue;

    const zIndex = computeZIndex(line.daysSinceActivity, line.ltdPoints);
    const path: { x: number; y: number }[] = [];

    for (let i = 0; i < line.values.length; i++) {
      path.push({
        x: indexToX(i, totalPoints, chart),
        y: valueToY(line.values[i], maxValue, chart),
      });
    }

    renderData.push({ line, opacity, zIndex, path });
  }

  // Sort by z-index ascending (lowest drawn first = furthest back)
  renderData.sort((a, b) => a.zIndex - b.zIndex);
  return renderData;
}

// --- Drawing ---
function drawLine(ctx: CanvasRenderingContext2D, path: { x: number; y: number }[], color: string, opacity: number, lineWidth: number) {
  if (opacity <= 0) return;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) {
    ctx.lineTo(path[i].x, path[i].y);
  }
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const chart = getChartArea(width, height);

  // X-axis line
  ctx.strokeStyle = "rgba(0, 0, 0, 0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chart.x, chart.y + chart.h);
  ctx.lineTo(chart.x + chart.w, chart.y + chart.h);
  ctx.stroke();

  // Compute real dates
  const today = new Date();
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);

  const formatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  // X-axis labels
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.font = "10px system-ui";
  ctx.textAlign = "left";
  ctx.fillText(formatDate(ninetyDaysAgo), chart.x + 8, chart.y + chart.h + 20);
  ctx.textAlign = "right";
  ctx.fillText(formatDate(today), chart.x + chart.w, chart.y + chart.h + 20);
}

function drawEventDot(ctx: CanvasRenderingContext2D, x: number, y: number, type: PrototypeEvent["type"], size: number) {
  ctx.save();
  const s = size * 1.8; // larger dots
  if (type === "win") {
    // Crown shape — white
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x - s, y + s * 0.4);
    ctx.lineTo(x - s * 0.5, y);
    ctx.lineTo(x, y + s * 0.4);
    ctx.lineTo(x + s * 0.5, y);
    ctx.lineTo(x + s, y + s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // White filled circle for all other types
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// --- Main render ---
let renderDataCache: LineRenderData[] = [];

function render() {
  const { width, height } = setupCanvases();

  const bgCtx = bgCanvas.getContext("2d")!;
  const fgCtx = fgCanvas.getContext("2d")!;
  const hlCtx = hlCanvas.getContext("2d")!;

  // Clear
  bgCtx.clearRect(0, 0, width, height);
  fgCtx.clearRect(0, 0, width, height);
  hlCtx.clearRect(0, 0, width, height);

  // Draw grid on background
  drawGrid(bgCtx, width, height);

  // Build render data
  renderDataCache = buildRenderData(width, height);

  // Draw lines on appropriate layers
  for (const rd of renderDataCache) {
    let effectiveOpacity = rd.opacity;

    if (selectedLineId) {
      if (rd.line.id === selectedLineId) {
        // Selected line goes on highlight layer
        continue;
      } else {
        // Dim proportionally
        effectiveOpacity *= DIM_MULTIPLIER;
      }
    }

    const layer = effectiveOpacity > 0.5 ? fgCtx : bgCtx;
    drawLine(layer, rd.path, rd.line.color, effectiveOpacity, BASE_LINE_WIDTH);

    // Labels are drawn after all lines (see below)
  }

  // --- Draw endpoint labels with stagger to avoid overlap ---
  if (!selectedLineId) {
    labelHitBoxes = []; // reset

    // Collect label candidates (only visible lines)
    const labelCandidates: { y: number; opacity: number; line: PrototypeLine; lastPt: { x: number; y: number } }[] = [];
    for (const rd of renderDataCache) {
      const effectiveOpacity = rd.opacity;
      if (effectiveOpacity <= 0.5) continue; // only label visible lines
      const lastPt = rd.path[rd.path.length - 1];
      labelCandidates.push({ y: lastPt.y, opacity: effectiveOpacity, line: rd.line, lastPt });
    }

    // Sort by Y position (top to bottom)
    labelCandidates.sort((a, b) => a.y - b.y);

    // Stagger: ensure minimum vertical gap between labels
    const MIN_GAP = 18; // px between label tops
    const resolvedPositions: { labelY: number; opacity: number; line: PrototypeLine; lastPt: { x: number; y: number } }[] = [];

    for (const candidate of labelCandidates) {
      let labelY = candidate.y;
      // Check against already-placed labels and push down if overlapping
      for (const placed of resolvedPositions) {
        if (Math.abs(labelY - placed.labelY) < MIN_GAP) {
          labelY = placed.labelY + MIN_GAP;
        }
      }
      resolvedPositions.push({ labelY, opacity: candidate.opacity, line: candidate.line, lastPt: candidate.lastPt });
    }

    // Draw labels
    for (const { labelY, opacity, line, lastPt } of resolvedPositions) {
      const ctx = fgCtx;
      ctx.globalAlpha = opacity;
      
      // Truncate text if too long
      const maxLabelWidth = 130;
      const primaryText = `${line.artistName} — ${line.name}`;
      ctx.font = "bold 9px system-ui";
      let displayText = primaryText;
      if (ctx.measureText(displayText).width > maxLabelWidth) {
        while (displayText.length > 3 && ctx.measureText(displayText + "...").width > maxLabelWidth) {
          displayText = displayText.slice(0, -1);
        }
        displayText += "...";
      }

      // Line 1: Artist — Song
      ctx.fillStyle = line.color;
      ctx.textAlign = "left";
      ctx.fillText(displayText, lastPt.x + 6, labelY - 1);

      // Line 2: Points · Wins (smaller, lighter)
      const finalValue = line.values[line.values.length - 1];
      const wins = line.events.filter(e => e.type === "win").length;
      const statsText = wins > 0
        ? `${finalValue.toLocaleString()} · ${wins}W`
        : `${finalValue.toLocaleString()}`;
      ctx.font = "8px system-ui";
      ctx.globalAlpha = opacity * 0.7;
      ctx.fillText(statsText, lastPt.x + 6, labelY + 8);

      // Register hit box for click detection
      labelHitBoxes.push({
        lineId: line.id,
        x: lastPt.x + 6,
        y: labelY - 10,
        width: maxLabelWidth,
        height: 20,
      });

      ctx.globalAlpha = 1;
    }
  }

  // Draw selected line on highlight layer
  if (selectedLineId) {
    const selected = renderDataCache.find(rd => rd.line.id === selectedLineId);
    if (selected) {
      drawLine(hlCtx, selected.path, selected.line.color, 1.0, BASE_LINE_WIDTH * HIGHLIGHT_MULTIPLIER);

      // Draw endpoint label (two lines)
      const lastPt = selected.path[selected.path.length - 1];
      hlCtx.fillStyle = selected.line.color;
      hlCtx.font = "bold 9px system-ui";
      hlCtx.textAlign = "left";
      hlCtx.fillText(`${selected.line.artistName} — ${selected.line.name}`, lastPt.x + 6, lastPt.y - 1);

      const finalValue = selected.line.values[selected.line.values.length - 1];
      const wins = selected.line.events.filter(e => e.type === "win").length;
      const statsText = wins > 0
        ? `${finalValue.toLocaleString()} · ${wins}W`
        : `${finalValue.toLocaleString()}`;
      hlCtx.font = "8px system-ui";
      hlCtx.globalAlpha = 0.7;
      hlCtx.fillText(statsText, lastPt.x + 6, lastPt.y + 8);
      hlCtx.globalAlpha = 1;

      // Draw event dots — one per unique date, priority determines shape
      const EVENT_PRIORITY: Record<string, number> = {
        win: 0,
        live_performance: 1,
        chart_appearance: 2,
        mv: 3,
        release: 4,
      };
      const drawnDates = new Set<number>();
      const sortedEvents = [...selected.line.events].sort(
        (a, b) => (EVENT_PRIORITY[a.type] ?? 99) - (EVENT_PRIORITY[b.type] ?? 99)
      );
      for (const event of sortedEvents) {
        if (event.dateIndex >= selected.path.length) continue;
        if (drawnDates.has(event.dateIndex)) continue;
        drawnDates.add(event.dateIndex);
        const pt = selected.path[event.dateIndex];
        drawEventDot(hlCtx, pt.x, pt.y, event.type, 8);
      }
    }
  }

  // Draw legend
  renderLegend();
}

function renderLegend() {
  const legend = document.getElementById("legend")!;
  legend.innerHTML = "";

  const types: { color: string; label: string }[] = [
    { color: "#2E7D32", label: "Boy Group" },
    { color: "#7B1FA2", label: "Girl Group" },
    { color: "#81C784", label: "Solo Male" },
    { color: "#CE93D8", label: "Solo Female" },
    { color: "#1565C0", label: "Mixed Group" },
  ];

  for (const t of types) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<div class="legend-swatch" style="background: ${t.color}"></div>${t.label}`;
    legend.appendChild(item);
  }

  // Event dot legend
  const dots: { icon: string; label: string }[] = [
    { icon: "👑", label: "Win" },
    { icon: "🎤", label: "Live Performance" },
    { icon: "📊", label: "Chart Appearance" },
    { icon: "◆", label: "MV Release" },
    { icon: "●", label: "Album Release" },
  ];

  for (const d of dots) {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<div class="legend-dot">${d.icon}</div>${d.label}`;
    legend.appendChild(item);
  }
}

// --- Label hit detection ---
interface LabelHitBox {
  lineId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

let labelHitBoxes: LabelHitBox[] = [];

// --- Hit detection ---
/** Check if a point is inside a label hit box */
function findLabelAtPoint(clientX: number, clientY: number): string | null {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  for (const box of labelHitBoxes) {
    if (x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height) {
      return box.lineId;
    }
  }
  return null;
}

/** Convert a data point index to its corresponding date */
function indexToDate(index: number): string {
  const today = new Date();
  const date = new Date(today);
  date.setDate(today.getDate() - (89 - index)); // index 0 = 90 days ago, index 89 = today
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function findLinesAtPoint(clientX: number, clientY: number): { rd: LineRenderData; nearestIndex: number }[] {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const hits: { rd: LineRenderData; nearestIndex: number }[] = [];

  for (const rd of renderDataCache) {
    if (rd.opacity <= 0) continue;
    // Check if point is near any segment of this line
    for (let i = 0; i < rd.path.length - 1; i++) {
      const dist = pointToSegmentDistance(x, y, rd.path[i], rd.path[i + 1]);
      if (dist <= HIT_RADIUS) {
        // Find nearest data point index
        const distToI = Math.hypot(x - rd.path[i].x, y - rd.path[i].y);
        const distToI1 = Math.hypot(x - rd.path[i + 1].x, y - rd.path[i + 1].y);
        const nearestIndex = distToI <= distToI1 ? i : i + 1;
        hits.push({ rd, nearestIndex });
        break;
      }
    }
  }

  return hits;
}

function pointToSegmentDistance(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y);

  let t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function findEventDotAtPoint(clientX: number, clientY: number): { line: PrototypeLine; event: PrototypeEvent; index: number } | null {
  if (!selectedLineId) return null;

  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const selected = renderDataCache.find(rd => rd.line.id === selectedLineId);
  if (!selected) return null;

  for (let i = 0; i < selected.line.events.length; i++) {
    const event = selected.line.events[i];
    if (event.dateIndex >= selected.path.length) continue;
    const pt = selected.path[event.dateIndex];
    const dist = Math.hypot(x - pt.x, y - pt.y);
    if (dist <= 10) {
      return { line: selected.line, event, index: i };
    }
  }

  return null;
}

// --- Event handlers ---
/** Artist type display labels */
const ARTIST_TYPE_LABELS: Record<string, string> = {
  boy_group: "Boy Group",
  girl_group: "Girl Group",
  solo_male: "Solo Male",
  solo_female: "Solo Female",
  mixed_group: "Mixed Group",
};

/** Generation roman numerals */
const GEN_LABELS = ["", "I", "II", "III", "IV", "V", "VI"];

function showTooltip(x: number, y: number, line: PrototypeLine, dateIndex: number, eventLabel?: string, showEmbed?: boolean) {
  const date = indexToDate(dateIndex);
  const value = line.values[dateIndex];
  const initials = line.artistName.slice(0, 2).toUpperCase();
  const typeLabel = ARTIST_TYPE_LABELS[line.artistType] ?? line.artistType;
  const genLabel = GEN_LABELS[Math.min(line.values.length % 6, 5)] || "IV"; // fake gen for prototype

  // Date row (+ source logo + event if any)
  const source = line.sources?.get(dateIndex);
  let dateRow = `<div class="tooltip-date-row">${date}`;
  if (source) {
    dateRow += ` <span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#fff;border-radius:3px;"><img src="${SOURCE_LOGOS[source]}" alt="${SOURCE_LABELS[source]}" style="width:14px;height:14px;object-fit:contain;"></span>${SOURCE_LABELS[source]}</span>`;
  }
  if (eventLabel) {
    dateRow += ` · <span class="tooltip-event-badge">${eventLabel}</span>`;
  }
  dateRow += `</div>`;

  // Logo + artist info side by side
  const logoHtml = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
      <div class="tooltip-logo">
        <span class="tooltip-logo-initials">${initials}</span>
      </div>
      <div>
        <div class="tooltip-artist-name">${line.artistName}</div>
        <div class="tooltip-meta">${typeLabel} · Gen ${genLabel}</div>
      </div>
    </div>
  `;

  // Points (only show if > 0) with daily gain
  let statsHtml = "";
  if (value > 0) {
    const prevValue = dateIndex > 0 ? line.values[dateIndex - 1] : 0;
    const gain = value - prevValue;
    if (gain > 0) {
      statsHtml = `<div class="tooltip-stats">${value.toLocaleString()} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.5);">+ ${gain.toLocaleString()}</span></div>`;
    } else {
      statsHtml = `<div class="tooltip-stats">${value.toLocaleString()} pts</div>`;
    }
  }

  // Embed (visible in tooltip too, not just popover)
  let embedHtml = "";
  if (showEmbed) {
    const eventsAtDate = line.events.filter(ev => ev.dateIndex === dateIndex);
    const hasVideo = eventsAtDate.some(e => e.type === "live_performance" || e.type === "mv");
    const hasRelease = eventsAtDate.some(e => e.type === "release");
    if (hasVideo) {
      embedHtml += `<div class="tooltip-embed tooltip-embed--video">▶</div>`;
    }
    if (hasRelease) {
      embedHtml += `<div class="tooltip-embed tooltip-embed--apple"><div style="text-align:center;padding:12px;font-size:0.65rem;color:#999;">🎵 Apple Music<br>Album embed here<br>(scrollable)</div></div>`;
    }
  }

  // Click hint for embeds
  const clickHint = showEmbed ? `<div class="tooltip-click-hint">click to engage</div>` : "";

  const html = `
    ${dateRow}
    ${logoHtml}
    <div class="tooltip-song">${line.name}</div>
    ${statsHtml}
    ${embedHtml}
    ${clickHint}
  `;

  tooltip.innerHTML = html;
  tooltip.style.background = line.color;
  tooltip.style.borderColor = line.color;
  tooltip.classList.remove("tooltip--has-embed");
  tooltip.style.display = "block";

  // Position with edge detection (always 14px gap)
  const containerRect = container.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const tw = tooltipRect.width || 200;
  const th = tooltipRect.height || 120;

  let left = x + 14;
  let top = y - 10;

  // Right edge
  if (left + tw > containerRect.width - 8) {
    left = x - tw - 14;
  }
  // Left edge
  if (left < 8) {
    left = 8;
  }
  // Bottom edge
  if (top + th > containerRect.height - 8) {
    top = containerRect.height - th - 8;
  }
  // Top edge
  if (top < 8) {
    top = 8;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function hideTooltip(force?: boolean) {
  if (popoverOpen && !force) return; // don't hide tooltip when popover is taking over
  tooltip.style.display = "none";
}

// --- Popover (click-to-engage version of tooltip with embeds) ---
function showPopover(line: PrototypeLine, dateIndex: number, eventLabel?: string) {
  const date = indexToDate(dateIndex);
  const value = line.values[dateIndex];
  const initials = line.artistName.slice(0, 2).toUpperCase();
  const typeLabel = ARTIST_TYPE_LABELS[line.artistType] ?? line.artistType;
  const genLabel = GEN_LABELS[Math.min(line.values.length % 6, 5)] || "IV";

  const source = line.sources?.get(dateIndex);
  let dateRow = `<div class="tooltip-date-row">${date}`;
  if (source) {
    dateRow += ` <span style="display:inline-flex;align-items:center;gap:4px;"><span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;background:#fff;border-radius:3px;"><img src="${SOURCE_LOGOS[source]}" alt="${SOURCE_LABELS[source]}" style="width:14px;height:14px;object-fit:contain;"></span>${SOURCE_LABELS[source]}</span>`;
  }
  if (eventLabel) {
    dateRow += ` · <span class="tooltip-event-badge">${eventLabel}</span>`;
  }
  dateRow += `</div>`;

  const logoHtml = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
      <div class="tooltip-logo">
        <span class="tooltip-logo-initials">${initials}</span>
      </div>
      <div>
        <div class="tooltip-artist-name">${line.artistName}</div>
        <div class="tooltip-meta">${typeLabel} · Gen ${genLabel}</div>
      </div>
    </div>
  `;

  let statsHtml = "";
  if (value > 0) {
    const prevValue = dateIndex > 0 ? line.values[dateIndex - 1] : 0;
    const gain = value - prevValue;
    if (gain > 0) {
      statsHtml = `<div class="tooltip-stats">${value.toLocaleString()} <span style="font-size: 0.6rem; color: rgba(255,255,255,0.5);">+ ${gain.toLocaleString()}</span></div>`;
    } else {
      statsHtml = `<div class="tooltip-stats">${value.toLocaleString()} pts</div>`;
    }
  }

  // Embeds
  const eventsAtDate = line.events.filter(ev => ev.dateIndex === dateIndex);
  const hasVideo = eventsAtDate.some(e => e.type === "live_performance" || e.type === "mv");
  const hasRelease = eventsAtDate.some(e => e.type === "release");
  let embedHtml = "";
  if (hasVideo) {
    embedHtml += `<div class="tooltip-embed tooltip-embed--video">▶</div>`;
  }
  if (hasRelease) {
    embedHtml += `<div class="tooltip-embed tooltip-embed--apple"><div style="text-align:center;padding:12px;font-size:0.65rem;color:#999;">🎵 Apple Music<br>Album embed here<br>(scrollable)</div></div>`;
  }

  popover.innerHTML = `
    ${dateRow}
    ${logoHtml}
    <div class="tooltip-song">${line.name}</div>
    ${statsHtml}
    ${embedHtml}
  `;
  popover.style.background = line.color;
  popover.style.borderColor = line.color;
  popover.style.display = "block";

  // Position in the exact same spot as the tooltip
  popover.style.left = tooltip.style.left;
  popover.style.top = tooltip.style.top;

  // Hide tooltip, show popover
  tooltip.style.display = "none";
  popoverOpen = true;
}

function hidePopover() {
  popover.style.display = "none";
  popoverOpen = false;
}

function showDisambiguation(x: number, y: number, lines: LineRenderData[]) {
  disambiguation.innerHTML = "";
  for (const rd of lines) {
    const item = document.createElement("div");
    item.className = "disambiguation-item";
    item.innerHTML = `<div class="color-swatch" style="background: ${rd.line.color}"></div>${rd.line.artistName} — ${rd.line.name}`;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      selectLine(rd.line.id);
      hideDisambiguation();
    });
    disambiguation.appendChild(item);
  }
  disambiguation.style.display = "block";

  // Position with edge detection
  const containerRect = container.getBoundingClientRect();
  let left = x;
  let top = y;

  // Wait a frame for the element to have dimensions
  requestAnimationFrame(() => {
    const popupRect = disambiguation.getBoundingClientRect();
    if (left + popupRect.width > containerRect.width - 8) {
      left = containerRect.width - popupRect.width - 8;
    }
    if (left < 8) left = 8;
    if (top + popupRect.height > containerRect.height - 8) {
      top = containerRect.height - popupRect.height - 8;
    }
    if (top < 8) top = 8;
    disambiguation.style.left = `${left}px`;
    disambiguation.style.top = `${top}px`;
  });

  disambiguation.style.left = `${left}px`;
  disambiguation.style.top = `${top}px`;
}

function hideDisambiguation() {
  disambiguation.style.display = "none";
}

function selectLine(id: string | null) {
  selectedLineId = id;
  hideTooltip(true);
  hidePopover();
  render();
}

// --- Mouse/touch events ---
hlCanvas.addEventListener("mousemove", (e) => {
  if (disambiguation.style.display === "block") return;
  if (popoverOpen) return; // don't update hover while popover is open

  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Check event dots first (if line is selected)
  const dotHit = findEventDotAtPoint(e.clientX, e.clientY);
  if (dotHit) {
    hlCanvas.style.cursor = "pointer";
    const TYPE_LABELS: Record<string, string> = {
      win: "Chart Win",
      live_performance: "Live Performance",
      chart_appearance: "Chart Appearance",
      mv: "Music Video",
      release: "Comeback",
    };
    const eventsAtDate = dotHit.line.events.filter(ev => ev.dateIndex === dotHit.event.dateIndex);
    const eventLabels = eventsAtDate.map(ev => TYPE_LABELS[ev.type] ?? ev.type).join(" · ");
    const hasEmbed = eventsAtDate.some(e => e.type === "live_performance" || e.type === "mv" || e.type === "release");
    showTooltip(x, y, dotHit.line, dotHit.event.dateIndex, eventLabels, hasEmbed);
    return;
  }

  // Check label hover (only when not in highlight mode)
  if (!selectedLineId) {
    const labelHit = findLabelAtPoint(e.clientX, e.clientY);
    if (labelHit) {
      hlCanvas.style.cursor = "pointer";
      hideTooltip();
      return;
    }
  }

  // Check lines
  const hits = findLinesAtPoint(e.clientX, e.clientY);
  if (hits.length === 0) {
    hlCanvas.style.cursor = "default";
    hideTooltip();
    return;
  }

  hlCanvas.style.cursor = "pointer";

  // When a line is already highlighted, don't show cluster hints
  if (selectedLineId) {
    const selectedHit = hits.find(h => h.rd.line.id === selectedLineId);
    if (selectedHit) {
      showTooltip(x, y, selectedHit.rd.line, selectedHit.nearestIndex);
    } else {
      hideTooltip();
    }
    return;
  }

  if (hits.length === 1) {
    const { rd, nearestIndex } = hits[0];
    showTooltip(x, y, rd.line, nearestIndex);
  } else {
    // Multiple hits — show hint that clicking will disambiguate
    tooltip.innerHTML = `<div style="font-size: 0.75rem; color: #fff;">${hits.length} lines here — click to choose</div>`;
    tooltip.style.background = "rgba(50, 50, 50, 0.9)";
    tooltip.style.borderColor = "rgba(50, 50, 50, 0.9)";
    tooltip.style.display = "block";
    const containerRect = container.getBoundingClientRect();
    let left = x + 14;
    let top = y - 10;
    if (left + 200 > containerRect.width - 8) left = x - 200 - 14;
    if (left < 8) left = 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
});

hlCanvas.addEventListener("click", (e) => {
  const rect = container.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  // Hide disambiguation if open and clicked elsewhere
  if (disambiguation.style.display === "block") {
    hideDisambiguation();
    return;
  }

  // Check label click (toggle highlight)
  const labelHit = findLabelAtPoint(e.clientX, e.clientY);
  if (labelHit) {
    if (selectedLineId) {
      // In highlight mode — any click deselects (back to all view)
      selectLine(null);
    } else {
      selectLine(labelHit);
    }
    return;
  }

  // Check event dot click — open popover with embeds
  const dotHit2 = findEventDotAtPoint(e.clientX, e.clientY);
  if (dotHit2) {
    const TYPE_LABELS2: Record<string, string> = {
      win: "Chart Win",
      live_performance: "Live Performance",
      chart_appearance: "Chart Appearance",
      mv: "Music Video",
      release: "Comeback",
    };
    const eventsAtDate2 = dotHit2.line.events.filter(ev => ev.dateIndex === dotHit2.event.dateIndex);
    const eventLabels2 = eventsAtDate2.map(ev => TYPE_LABELS2[ev.type] ?? ev.type).join(" · ");
    showPopover(dotHit2.line, dotHit2.event.dateIndex, eventLabels2);
    return;
  }

  // Check line clicks
  const hits = findLinesAtPoint(e.clientX, e.clientY);
  if (hits.length === 0) {
    if (popoverOpen) {
      // First click outside popover: close popover, stay in highlight mode
      hidePopover();
      return;
    }
    // Second click: deselect highlight
    selectLine(null);
    hideDisambiguation();
    return;
  }

  if (selectedLineId) {
    if (popoverOpen) {
      // Close popover first, stay in highlight
      hidePopover();
      return;
    }
    // Already highlighting — clicking deselects
    selectLine(null);
    return;
  }

  if (hits.length === 1) {
    selectLine(hits[0].rd.line.id);
  } else {
    // Show disambiguation popup
    showDisambiguation(x, y, hits.map(h => h.rd));
  }
});

hlCanvas.addEventListener("mouseleave", () => {
  if (!popoverOpen) {
    hideTooltip(true);
  }
});

// Escape to deselect
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (popoverOpen) {
      hidePopover();
    } else {
      selectLine(null);
    }
    hideDisambiguation();
  }
});

// Resize handling
window.addEventListener("resize", () => {
  hideDisambiguation();
  hideTooltip(true);
  render();
});

// --- Initial render ---
render();
