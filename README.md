# GPU City — flat textured tile grid + 3D instanced props (realtime)

A low-poly city renderer in a single self-contained `index.html` (Three.js r0.184, WebGL2):

- **Flat terrain grid**, tiles drawn from a **32-texture atlas** (a `DataArrayTexture` / `sampler2DArray`), sampled per tile in the terrain shader.
- **3D trees** (~500-poly low-poly model) on ~**10%** of tiles, and **3D buildings** of varied height — both `InstancedMesh` layers.
- **Distant-sun `DirectionalLight` with cast shadows** + a hemisphere sky/ground ambient.
- **Realtime editing** and a **stress test that randomizes 5% of all tiles every frame**.

It renders in **3 draw calls** (terrain + trees + buildings), and that stays constant regardless of grid size, number of trees/buildings, or edit rate — comfortably under the ~100 budget.

## The key idea: one state texture drives everything

There are **no per-tile or per-prop JS objects**. A single **RGBA8 state texture** is the source of truth:

| channel | meaning |
|---|---|
| **R** | terrain texture index (0–31) → which atlas layer the tile shows |
| **G** | prop type (0 none, 1 tree, 2 building) |
| **B** | per-tile variant (tree rotation/scale, building height) |

- The **terrain** quad samples R → texture array layer.
- The **trees** and **buildings** are full-grid `InstancedMesh` layers (one instance per tile). Each instance's **placement and visibility are computed in the vertex shader** by reading its tile's state: non-matching instances collapse to a degenerate point (and a matching `customDepthMaterial` keeps shadows correct).

**So editing anything — including the 5%/frame stress test — is just a texture write. No instance buffers are ever rebuilt**, which is exactly why mass realtime edits stay cheap (this was the whole point: JS object churn was the bottleneck to avoid).

## Run

ES modules + a CDN import map require HTTP — serve the folder (you can't open `index.html` from `file://`):

```bash
npm run serve          # python3 -m http.server 8080
# then open http://localhost:8080/
```

No build step. Three.js is pinned to `three@0.184.0` via the import map in `index.html`.

## Test (headless, no GPU)

```bash
npm install            # three@0.184.0 as a devDependency (test only)
npm test               # node test/drawcall.test.mjs
```

Builds the real scene structure (terrain plane + two `InstancedMesh` of N² each + a shadow-casting sun) against a stubbed WebGL2 context and asserts the **main-pass draw-call count is bounded (< 100) and identical for N = 64 and N = 256** — i.e. independent of tile count. Expected output:

```
grid 64   (  4096 tiles,    8192 prop instances)  ->  main-pass draw calls = 3  OK
grid 256  ( 65536 tiles,  131072 prop instances)  ->  main-pass draw calls = 3  OK
PASS: draw calls are bounded and independent of tile count.
```

## Controls

| Input | Action |
|-------|--------|
| **Left-click** | Paint the selected tool over a brush-sized square |
| **BUILD** buttons | Tree / Bldg / Road / Grass / Water / Clear (Clear removes the prop) |
| **BRUSH** buttons | Footprint: 1×1 / 4×4 / 16×16 tiles |
| **STRESS** button (or **S**) | Toggle: randomize 5% of all tiles every frame |
| **Drag** | Rotate · **Arrow keys** Pan · **Z / X** or scroll Zoom |
| **1–3** | Grid size 64 / 128 / 256 |

The HUD shows live draw calls (green while < 100), FPS + frame-time sparkline, grid/tile counts, tree-instance capacity, and **edits/sec** (which the stress test drives into the millions).

## Notes & limits

- **Trees and buildings are 3D; the terrain stays flat** (this is the requested design). The flat terrain keeps the grid editable and the ground at ~1 draw call; the props are real geometry with height and shadows.
- **Scale ceiling.** Props use *full-grid* instancing (one instance per tile, GPU-culled to the ~10% that are visible) so that any tile can become a prop in realtime with zero buffer rebuilds. The cost is per-tile vertex work, so grid size is capped at **256** here (vs the millions of tiles the flat-only version reached). Switching grid rebuilds the instanced layers once.
- **"120 fps" is vsync-bound** — `requestAnimationFrame` caps at the display refresh.
- The earlier **flat, single-draw-call** version (no 3D props/lighting) is preserved in git history if you want the scale-independent terrain-only baseline.

## Files

```
index.html                 self-contained app (import map + HUD + all logic/shaders inline)
test/drawcall.test.mjs     headless draw-call test (bounded & tile-count-independent)
package.json               npm test + serve scripts; three@0.184.0 devDependency
```
