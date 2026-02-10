# ⚛️ Wave Function Collapse – Terrain Grid

An interactive terrain generator built with the **Wave Function Collapse** (WFC) algorithm. Click any cell on the grid and watch constraints propagate outward as the map collapses into a coherent landscape of sea, ground, mountains, and houses.

![HTML5](https://img.shields.io/badge/HTML5-Canvas-orange) ![Vanilla JS](https://img.shields.io/badge/JavaScript-ES%20Modules-yellow) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020)

**Live demo →** [super-position-grid.diogodebastos18.workers.dev](https://super-position-grid.diogodebastos18.workers.dev)

## How It Works

Each cell starts in **superposition** — it could become any terrain type. When you click a cell, the algorithm:

1. **Collapses** that cell to a single terrain type (weighted random).
2. **Propagates** constraints to neighbours, removing impossible options.
3. **Repeats** — picks the uncollapsed cell with the lowest entropy (fewest remaining options), collapses it, and propagates again until the entire grid is resolved.

## Terrain Types

| Terrain | Elevation | Emoji | Description |
|---------|-----------|-------|-------------|
| Sea | z = 0 | 🌊 | Water tiles; can only border sea or low ground |
| Ground | z = 0–5 | 🌿 | Land with increasing elevation; darkens as z rises |
| Mountain | z = 6–10 | ⛰️ | High terrain; only borders cells with z ≥ 5 |
| House | z = 0–10 | 🏠 | Appears only when all 8 adjacent cells share the same terrain type |

## Adjacency Rules

- **Sea** borders sea or ground at z = 0.
- **Ground** borders any other ground; only ground at z ≥ 5 can border mountains.
- **Mountains** require all cardinal neighbours to have z ≥ 5.
- **Houses** are placed only when every one of their 8 neighbours (including diagonals) is the same terrain type.

## Running Locally

No build step required — just serve the `public/` directory with any static HTTP server:

```bash
# Python
python3 -m http.server 8765 -d public

# Or via Wrangler (Cloudflare local preview)
npm install
npm run preview
```

Then open [http://localhost:8765](http://localhost:8765) in your browser.

## Deployment

Hosted on **Cloudflare Workers** as a static site. To redeploy:

```bash
npm run deploy
```

## Controls

| Control | Description |
|---------|-------------|
| **Width / Height** | Set grid dimensions (4–60 × 4–40) |
| **Speed** | Animation speed from *Blazing* to *Very Slow* |
| **New Grid** | Reset and generate a fresh grid |
| **Click a cell** | Start the collapse from that cell |

## Project Structure

```
public/
  index.html   – Page layout, controls, and legend
  style.css    – Dark-theme styling
  main.js      – Wires up the WFC engine, renderer, and UI
  wfc.js       – WFC engine: tile catalogue, adjacency rules, propagation
  renderer.js  – Canvas rendering, colour palette, and animations
wrangler.jsonc – Cloudflare Workers config
package.json   – Scripts & dev dependencies
```

## License

MIT
