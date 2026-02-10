/**
 * renderer.js – Canvas rendering for the WFC terrain grid.
 */

const CELL_SIZE = 32;
const CELL_GAP = 1;

// ── Colour palette ──────────────────────────────────────────────────────────

const TERRAIN_COLOURS = {
  sea:      { base: "#2563eb", dark: "#1d4ed8" },
  ground0:  { base: "#65a30d", dark: "#4d7c0f" },
  ground1:  { base: "#4d7c0f", dark: "#365314" },
  ground2:  { base: "#3f6b0a", dark: "#2d5306" },
  ground3:  { base: "#365a06", dark: "#264503" },
  ground4:  { base: "#2d4a03", dark: "#1e3502" },
  ground5:  { base: "#253f02", dark: "#1a2e01" },
  mountain: { base: "#78716c", dark: "#57534e" },
  house:    { base: "#f59e0b", dark: "#d97706" },
};

const SUPERPOSITION_BG  = "#27272a";
const JUST_COLLAPSED_BG = "#fbbf24";     // flash colour
const PROPAGATED_BG     = "#4338ca";     // brief highlight

// ── Emojis / icons for each terrain ─────────────────────────────────────────

const TERRAIN_ICON = {
  sea:      "🌊",
  ground:   "🌿",
  mountain: "⛰️",
  house:    "🏠",
};

// ── Renderer class ──────────────────────────────────────────────────────────

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} gridW  – grid columns
   * @param {number} gridH  – grid rows
   */
  constructor(canvas, gridW, gridH) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.gridW = gridW;
    this.gridH = gridH;

    // Fit canvas
    this.cellPx = CELL_SIZE;
    this.gap = CELL_GAP;
    canvas.width = gridW * (this.cellPx + this.gap) + this.gap;
    canvas.height = gridH * (this.cellPx + this.gap) + this.gap;

    // Highlight state for animation
    this.highlights = new Map();  // idx → { colour, frames }
  }

  /** Convert pixel coords → cell index or -1 */
  hitTest(px, py) {
    const step = this.cellPx + this.gap;
    const cx = Math.floor((px - this.gap) / step);
    const cy = Math.floor((py - this.gap) / step);
    if (cx < 0 || cy < 0 || cx >= this.gridW || cy >= this.gridH) return -1;
    return cy * this.gridW + cx;
  }

  /** Mark cells for brief highlight. */
  flashCells(indices, colour, frames = 6) {
    for (const idx of indices) {
      this.highlights.set(idx, { colour, frames });
    }
  }

  /** Draw the entire grid given a WFCGrid. */
  draw(grid) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, w, h);

    const step = this.cellPx + this.gap;

    for (let y = 0; y < this.gridH; y++) {
      for (let x = 0; x < this.gridW; x++) {
        const idx = y * this.gridW + x;
        const px = this.gap + x * step;
        const py = this.gap + y * step;

        const tile = grid.getTile(idx);
        let bg;
        let icon = null;
        let label = null;

        if (tile) {
          const key = tile.terrain === "ground" ? `ground${tile.z}` : tile.terrain;
          const palette = TERRAIN_COLOURS[key] || TERRAIN_COLOURS[tile.terrain] || TERRAIN_COLOURS.ground0;
          // Darken based on mountain elevation
          if (tile.terrain === "mountain") {
            const frac = (tile.z - 6) / 4;  // z=6→0, z=10→1
            bg = lerpColour(palette.base, "#d6d3d1", frac * 0.6);
          } else {
            bg = palette.base;
          }
          icon = TERRAIN_ICON[tile.terrain];
          label = `z${tile.z}`;
        } else {
          // Superposition – show entropy
          const entropy = grid.getEntropy(idx);
          const frac = Math.min(entropy / 20, 1);
          bg = lerpColour("#312e81", SUPERPOSITION_BG, frac);
          label = `${entropy}`;
        }

        // Apply highlight overlay
        const hl = this.highlights.get(idx);
        if (hl) {
          const alpha = hl.frames / 8;
          bg = blendColour(bg, hl.colour, alpha * 0.55);
          hl.frames--;
          if (hl.frames <= 0) this.highlights.delete(idx);
        }

        // Draw cell background
        ctx.fillStyle = bg;
        roundRect(ctx, px, py, this.cellPx, this.cellPx, 3);
        ctx.fill();

        // Draw icon
        if (icon) {
          ctx.font = `${this.cellPx * 0.48}px serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(icon, px + this.cellPx / 2, py + this.cellPx * 0.42);
        }

        // Draw label
        if (label) {
          ctx.font = `bold ${this.cellPx * 0.25}px "Inter", system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillStyle = tile ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)";
          ctx.fillText(label, px + this.cellPx / 2, py + this.cellPx - 2);
        }
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function parseHex(hex) {
  hex = hex.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

function toHex(r, g, b) {
  return "#" + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
}

function lerpColour(a, b, t) {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function blendColour(base, overlay, alpha) {
  return lerpColour(base, overlay, alpha);
}
