/**
 * main.js – Wires up the WFC engine, renderer, and UI controls.
 */

import { WFCGrid } from "./wfc.js";
import { Renderer } from "./renderer.js";

// ── DOM refs ────────────────────────────────────────────────────────────────

const canvas     = document.getElementById("grid-canvas");
const inputW     = document.getElementById("input-width");
const inputH     = document.getElementById("input-height");
const inputSpeed = document.getElementById("input-speed");
const btnReset   = document.getElementById("btn-reset");
const statusText = document.getElementById("status-text");
const statusCount= document.getElementById("status-count");

// ── State ───────────────────────────────────────────────────────────────────

let gridW   = +inputW.value;
let gridH   = +inputH.value;
let grid    = null;
let renderer = null;
let running  = false;
let animId   = null;

// ── Initialise ──────────────────────────────────────────────────────────────

function init() {
  cancelAnim();
  running = false;
  gridW = Math.max(4, Math.min(60, +inputW.value));
  gridH = Math.max(4, Math.min(40, +inputH.value));

  grid = new WFCGrid(gridW, gridH);
  renderer = new Renderer(canvas, gridW, gridH);
  renderer.draw(grid);

  statusText.textContent = "Click a cell to begin collapse…";
  updateCount();
}

function updateCount() {
  const total = grid.size;
  const done = grid.totalCollapsed();
  statusCount.textContent = `${done} / ${total} collapsed`;
}

// ── Animation loop ──────────────────────────────────────────────────────────

function cancelAnim() {
  if (animId !== null) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

/**
 * Step through the WFC generator, yielding to the browser between steps
 * so the user sees an animated propagation.
 */
async function animate(gen) {
  running = true;
  statusText.textContent = "Collapsing…";

  const delayMs = () => +inputSpeed.value;

  function step() {
    if (!running) return;

    const { value: event, done } = gen.next();
    if (done) {
      running = false;
      statusText.textContent = "✅ Generation complete!";
      renderer.draw(grid);
      updateCount();
      return;
    }

    switch (event.type) {
      case "collapse":
        renderer.flashCells([event.idx], "#fbbf24", 8);
        break;

      case "propagate":
        renderer.flashCells(event.changed, "#6366f1", 5);
        break;

      case "contradiction":
        running = false;
        statusText.textContent = "⚠️ Contradiction! Try again with a new grid.";
        renderer.draw(grid);
        updateCount();
        return;

      case "done":
        running = false;
        statusText.textContent = "✅ Generation complete!";
        renderer.draw(grid);
        updateCount();
        return;
    }

    renderer.draw(grid);
    updateCount();

    // Schedule next step
    if (delayMs() < 10) {
      // Batch multiple steps per frame for "blazing" speed
      animId = requestAnimationFrame(() => {
        for (let i = 0; i < 5 && running; i++) {
          const inner = gen.next();
          if (inner.done) { running = false; break; }
          if (inner.value.type === "collapse") {
            renderer.flashCells([inner.value.idx], "#fbbf24", 4);
          } else if (inner.value.type === "propagate") {
            renderer.flashCells(inner.value.changed, "#6366f1", 3);
          } else if (inner.value.type === "contradiction") {
            running = false;
            statusText.textContent = "⚠️ Contradiction! Try again with a new grid.";
          } else if (inner.value.type === "done") {
            running = false;
            statusText.textContent = "✅ Generation complete!";
          }
        }
        renderer.draw(grid);
        updateCount();
        if (running) step();
      });
    } else {
      setTimeout(() => {
        animId = requestAnimationFrame(step);
      }, delayMs());
    }
  }

  step();
}

// ── Event handlers ──────────────────────────────────────────────────────────

canvas.addEventListener("click", (e) => {
  if (running) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const idx = renderer.hitTest(px, py);

  if (idx < 0) return;
  if (grid.isCollapsed(idx)) return;

  // If grid is already partially done (shouldn't happen on first click), reset
  if (grid.totalCollapsed() > 0) {
    init();
  }

  const gen = grid.run(idx);
  animate(gen);
});

btnReset.addEventListener("click", init);
inputW.addEventListener("change", init);
inputH.addEventListener("change", init);

// ── Render loop for highlight fade ──────────────────────────────────────────

function renderLoop() {
  if (!running && renderer.highlights.size > 0) {
    renderer.draw(grid);
  }
  requestAnimationFrame(renderLoop);
}

// ── Boot ────────────────────────────────────────────────────────────────────

init();
renderLoop();
