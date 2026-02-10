/**
 * wfc.js – Wave Function Collapse engine for the terrain grid.
 *
 * Each "tile" is a { terrain, z } pair.  We pre-compute every legal tile
 * and the adjacency constraints between them, then run a standard WFC loop:
 *   1. pick the un-collapsed cell with the lowest entropy
 *   2. collapse it (weighted random from its remaining options)
 *   3. propagate constraints to neighbours
 *
 * The engine is a generator so the caller can step through it and animate.
 */

// ── Tile catalogue ──────────────────────────────────────────────────────────

/** All possible tile states a single cell can hold. */
function buildTileCatalogue() {
  const tiles = [];

  // Sea: z=0
  tiles.push({ terrain: "sea", z: 0 });

  // Ground: z=0..5
  for (let z = 0; z <= 5; z++) {
    tiles.push({ terrain: "ground", z });
  }

  // Mountain: z=6..10 (only above elevation 5)
  for (let z = 6; z <= 10; z++) {
    tiles.push({ terrain: "mountain", z });
  }

  // House: can sit on ground or mountain z-levels
  for (let z = 0; z <= 10; z++) {
    tiles.push({ terrain: "house", z });
  }

  return tiles;
}

const ALL_TILES = buildTileCatalogue();
const TILE_INDEX = new Map();          // key → index
ALL_TILES.forEach((t, i) => {
  TILE_INDEX.set(`${t.terrain}:${t.z}`, i);
});
const N_TILES = ALL_TILES.length;

// ── Cardinal adjacency rules (N, E, S, W) ──────────────────────────────────

/**
 * Returns true when tile A can sit cardinally adjacent to tile B
 * according to the terrain rules.
 */
function cardinalCompatible(a, b) {
  // Sea adjacency
  if (a.terrain === "sea") {
    if (b.terrain === "sea") return true;
    if (b.terrain === "ground" && b.z === 0) return true;
    return false;
  }

  // Ground adjacency
  if (a.terrain === "ground") {
    if (b.terrain === "sea") return a.z === 0;
    if (b.terrain === "ground") return true;
    if (b.terrain === "mountain") return a.z >= 5;  // only high ground borders mountains
    if (b.terrain === "house") return true;
    return false;
  }

  // Mountain adjacency: can only be adjacent to cells with z>=5
  if (a.terrain === "mountain") {
    return b.z >= 5;
  }

  // House adjacency (cardinal): house sits on ground/mountain, and cardinal
  // neighbours just follow its underlying z constraints.
  // House inherits ground/mountain-like rules for cardinal adjacency.
  if (a.terrain === "house") {
    // House must not be fully surrounded by sea – handled at higher level
    // Cardinal: treat house like its underlying terrain for adjacency
    if (b.terrain === "sea") return a.z === 0;
    return true;
  }

  return false;
}

/**
 * Pre-compute per-tile allowed neighbour sets (as BitSets for speed).
 * allowedCardinal[i] → Set of tile indices allowed cardinally adjacent to i.
 */
function buildAdjacencySets() {
  const allowed = new Array(N_TILES);
  for (let i = 0; i < N_TILES; i++) {
    const set = new Set();
    for (let j = 0; j < N_TILES; j++) {
      if (cardinalCompatible(ALL_TILES[i], ALL_TILES[j])) {
        set.add(j);
      }
    }
    allowed[i] = set;
  }
  return allowed;
}

const CARDINAL_ALLOWED = buildAdjacencySets();

// ── Bit-set helpers (Uint8Array bitmask) ────────────────────────────────────

function bitsNew() {
  return new Uint8Array(Math.ceil(N_TILES / 8)).fill(0);
}

function bitsAll() {
  const b = bitsNew();
  for (let i = 0; i < N_TILES; i++) bitsSet(b, i);
  return b;
}

function bitsSet(b, i) { b[i >> 3] |= 1 << (i & 7); }
function bitsClear(b, i) { b[i >> 3] &= ~(1 << (i & 7)); }
function bitsHas(b, i) { return (b[i >> 3] >> (i & 7)) & 1; }

function bitsCount(b) {
  let c = 0;
  for (let i = 0; i < N_TILES; i++) if (bitsHas(b, i)) c++;
  return c;
}

function bitsClone(b) { return b.slice(); }

function bitsEqual(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function bitsForEach(b, fn) {
  for (let i = 0; i < N_TILES; i++) if (bitsHas(b, i)) fn(i);
}

// ── Grid / Wave state ───────────────────────────────────────────────────────

export class WFCGrid {
  /**
   * @param {number} width
   * @param {number} height
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.size = width * height;

    /** Each cell holds a bitset of possible tile indices. */
    this.wave = new Array(this.size);

    /** Collapsed tile index per cell (-1 while in superposition). */
    this.collapsed = new Int16Array(this.size).fill(-1);

    /** Track which cells have been touched during propagation for animation. */
    this.dirty = new Set();

    this.reset();
  }

  reset() {
    for (let i = 0; i < this.size; i++) {
      this.wave[i] = bitsAll();
      this.collapsed[i] = -1;
    }
    this.dirty.clear();

    // Remove house tiles from edge cells (houses need 8 neighbours inside grid)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1) {
          this._removeHouseTiles(this._idx(x, y));
        }
      }
    }
  }

  _idx(x, y) { return y * this.width + x; }
  _xy(idx) { return [idx % this.width, Math.floor(idx / this.width)]; }

  _removeHouseTiles(idx) {
    for (let i = 0; i < N_TILES; i++) {
      if (ALL_TILES[i].terrain === "house") {
        bitsClear(this.wave[idx], i);
      }
    }
  }

  /** Cardinal neighbours of cell idx. */
  _cardinalNeighbours(idx) {
    const [x, y] = this._xy(idx);
    const ns = [];
    if (x > 0) ns.push(this._idx(x - 1, y));
    if (x < this.width - 1) ns.push(this._idx(x + 1, y));
    if (y > 0) ns.push(this._idx(x, y - 1));
    if (y < this.height - 1) ns.push(this._idx(x, y + 1));
    return ns;
  }

  /** All 8 neighbours. */
  _allNeighbours(idx) {
    const [x, y] = this._xy(idx);
    const ns = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height) {
          ns.push(this._idx(nx, ny));
        }
      }
    }
    return ns;
  }

  // ── Entropy & selection ─────────────────────────────────────────────────

  /** Pick the un-collapsed cell with lowest entropy (ties broken randomly). */
  _pickLowestEntropy() {
    let best = Infinity;
    let candidates = [];
    for (let i = 0; i < this.size; i++) {
      if (this.collapsed[i] !== -1) continue;
      const c = bitsCount(this.wave[i]);
      if (c === 0) return -1; // contradiction
      if (c < best) {
        best = c;
        candidates = [i];
      } else if (c === best) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) return -2; // all collapsed
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  // ── Collapse ────────────────────────────────────────────────────────────

  /**
   * Collapse a cell to one of its remaining options (weighted random).
   * Weights bias toward more "interesting" terrain variation.
   */
  _collapseCell(idx) {
    const options = [];
    bitsForEach(this.wave[idx], i => options.push(i));
    if (options.length === 0) return false; // contradiction

    // Weight assignment: give varied weights to encourage variety
    const weights = options.map(i => {
      const t = ALL_TILES[i];
      if (t.terrain === "sea") return 6;
      if (t.terrain === "ground") return 8 - t.z;  // z0=8, z1=7 … z5=3
      if (t.terrain === "mountain") return 2 + (10 - t.z) * 0.3;
      if (t.terrain === "house") return 0.6;
      return 1;
    });

    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let chosen = options[0];
    for (let k = 0; k < options.length; k++) {
      r -= weights[k];
      if (r <= 0) { chosen = options[k]; break; }
    }

    // Set wave to only the chosen tile
    this.wave[idx] = bitsNew();
    bitsSet(this.wave[idx], chosen);
    this.collapsed[idx] = chosen;
    this.dirty.add(idx);
    return true;
  }

  // ── Constraint propagation ──────────────────────────────────────────────

  /**
   * Propagate constraints from a set of recently-changed cells.
   * Returns the set of cells whose wave changed (for animation).
   */
  _propagate(seeds) {
    const stack = [...seeds];
    const changed = new Set(seeds);

    while (stack.length > 0) {
      const current = stack.pop();

      // ── Cardinal adjacency constraints ──
      const cardinalNs = this._cardinalNeighbours(current);
      for (const nIdx of cardinalNs) {
        if (this.collapsed[nIdx] !== -1) continue;

        const before = bitsClone(this.wave[nIdx]);

        // The neighbour can only keep tiles compatible with ALL possibilities of current
        const newWave = bitsNew();
        bitsForEach(this.wave[nIdx], nTile => {
          let ok = false;
          bitsForEach(this.wave[current], cTile => {
            if (CARDINAL_ALLOWED[cTile].has(nTile)) ok = true;
          });
          if (ok) bitsSet(newWave, nTile);
        });

        this._enforceHouseConstraints(nIdx, newWave);

        if (!bitsEqual(before, newWave)) {
          this.wave[nIdx] = newWave;
          this.dirty.add(nIdx);
          changed.add(nIdx);
          if (bitsCount(newWave) === 1) {
            bitsForEach(newWave, t => { this.collapsed[nIdx] = t; });
          }
          stack.push(nIdx);
        }
      }

      // ── All-8-neighbour house constraint propagation ──
      // When a cell changes, any of its 8 neighbours that still have
      // house tiles must be re-checked (diagonals matter for houses).
      const allNs = this._allNeighbours(current);
      for (const nIdx of allNs) {
        if (this.collapsed[nIdx] !== -1) continue;

        const before = bitsClone(this.wave[nIdx]);
        this._enforceHouseConstraints(nIdx, this.wave[nIdx]);

        if (!bitsEqual(before, this.wave[nIdx])) {
          this.dirty.add(nIdx);
          changed.add(nIdx);
          if (bitsCount(this.wave[nIdx]) === 1) {
            bitsForEach(this.wave[nIdx], t => { this.collapsed[nIdx] = t; });
          }
          stack.push(nIdx);
        }
      }
    }

    return changed;
  }

  /**
   * Enforce extra house constraints:
   * - House needs all 8 neighbours inside the grid (no edge placement)
   * - All 8 adjacent cells must BE the same terrain type.
   *   Collapsed neighbours must already match; uncollapsed neighbours
   *   must still be able to become that type.
   */
  _enforceHouseConstraints(idx, wave) {
    const [x, y] = this._xy(idx);
    const atEdge = x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;

    for (let t = 0; t < N_TILES; t++) {
      if (!bitsHas(wave, t)) continue;
      if (ALL_TILES[t].terrain !== "house") continue;

      // Must not be on edge
      if (atEdge) { bitsClear(wave, t); continue; }

      const allNeigh = this._allNeighbours(idx);

      // Determine which terrain types are still viable for uniformity.
      // A terrain is viable only if every collapsed neighbour IS that
      // terrain and every uncollapsed neighbour CAN still be it.
      const candidateTerrains = ["sea", "ground", "mountain"];
      let foundUniform = false;

      for (const terrain of candidateTerrains) {
        let allMatch = true;
        for (const nIdx of allNeigh) {
          if (this.collapsed[nIdx] !== -1) {
            // Already decided – must actually be this terrain
            if (ALL_TILES[this.collapsed[nIdx]].terrain !== terrain) {
              allMatch = false;
              break;
            }
          } else {
            // Still in superposition – must have at least one option of this terrain
            let canBe = false;
            bitsForEach(this.wave[nIdx], nt => {
              if (ALL_TILES[nt].terrain === terrain) canBe = true;
            });
            if (!canBe) { allMatch = false; break; }
          }
        }
        if (allMatch) { foundUniform = true; break; }
      }

      if (!foundUniform) { bitsClear(wave, t); }
    }
  }

  // ── Generator: step-by-step collapse for animation ──────────────────────

  /**
   * Yields events that the renderer can animate:
   *   { type: "collapse", idx, tile }
   *   { type: "propagate", changed: Set<idx> }
   *   { type: "done" }
   *   { type: "contradiction", idx }
   *
   * @param {number} startIdx – The cell the user clicked
   */
  *run(startIdx) {
    // 1. Collapse the starting cell
    if (!this._collapseCell(startIdx)) {
      yield { type: "contradiction", idx: startIdx };
      return;
    }
    yield { type: "collapse", idx: startIdx, tile: this.collapsed[startIdx] };

    // 2. Propagate from it
    const firstChanged = this._propagate([startIdx]);
    yield { type: "propagate", changed: new Set(firstChanged) };

    // 3. Main loop
    while (true) {
      const next = this._pickLowestEntropy();
      if (next === -2) { yield { type: "done" }; return; } // all done
      if (next === -1) { yield { type: "contradiction", idx: -1 }; return; }

      if (!this._collapseCell(next)) {
        yield { type: "contradiction", idx: next };
        return;
      }
      yield { type: "collapse", idx: next, tile: this.collapsed[next] };

      const changed = this._propagate([next]);
      yield { type: "propagate", changed: new Set(changed) };
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  getTile(idx) {
    if (this.collapsed[idx] === -1) return null;
    return ALL_TILES[this.collapsed[idx]];
  }

  getEntropy(idx) {
    return bitsCount(this.wave[idx]);
  }

  isCollapsed(idx) {
    return this.collapsed[idx] !== -1;
  }

  totalCollapsed() {
    let c = 0;
    for (let i = 0; i < this.size; i++) if (this.collapsed[i] !== -1) c++;
    return c;
  }
}

export { ALL_TILES, N_TILES };
