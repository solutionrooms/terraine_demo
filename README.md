# GPU City — flat textured tile grid + 3D instanced props (realtime)

A low-poly city renderer in a single self-contained `index.html` (Three.js r0.184, WebGL2):

- **Flat terrain grid**, tiles drawn from a **32-texture atlas** (a `DataArrayTexture` / `sampler2DArray`) keyed by a per-tile **R8 state texture**. The terrain is one quad whose cost is independent of tile count, so it scales **64² → 4096²**.
- **3D trees** (~500-poly low-poly model) + **3D buildings** (varied height) as `InstancedMesh` layers.
- **Distant-sun `DirectionalLight` with cast shadows** (toggleable) + hemisphere ambient.
- **Realtime editing** (paint tools + brushes) and a **stress test that randomizes 5% of tiles every frame**.
- Renders in **3 draw calls** (terrain + trees + buildings) — well under the ~100 budget.

## Architecture

**Terrain** is a single `PlaneGeometry` quad. A per-tile **R8 `DataTexture`** holds the terrain texture index (0–31); the terrain shader (a `MeshLambertMaterial` patched via `onBeforeCompile`) samples it and looks the tile up in the 32-layer texture array. Editing the terrain is a texture write — which is why the **5%/frame stress test scales**: it's just an `R8` upload, not geometry churn.

**Props** (trees, buildings) are two **capped instanced pools** — a fixed instance budget independent of grid size, which is what lets the grid scale to 4096² without 16.7M instances. Placement happens on edit: paint a tile → grab the next free instance, write its matrix with a reused `Object3D` (no per-edit allocation); clear a tile → swap-remove the last instance into the gap. Shadows fall out for free from Three's default `InstancedMesh` depth path (no custom shaders).

At large grids the 5% prop coverage is capped to the instance budget, so props get sparser relative to the (still fully textured) terrain.

## Run

ES modules + a CDN import map require HTTP — serve the folder (you can't open `index.html` from `file://`):

```bash
npm run serve          # python3 -m http.server 8080
# then open http://localhost:8080/
```

No build step. Three.js is pinned to `three@0.184.0` via the import map.

## Test (headless, no GPU)

```bash
npm install            # three@0.184.0 as a devDependency (test only)
npm test               # node test/drawcall.test.mjs
```

Builds the scene structure against a stubbed WebGL2 context and asserts the **main-pass draw-call count is bounded (< 100) and identical for N = 64 and N = 256** — independent of tile count.

## Controls

| Input | Action |
|-------|--------|
| **Left-click** | Paint the selected tool over a brush-sized square |
| **BUILD** buttons | Tree / Bldg / Road / Grass / Water / Clear |
| **BRUSH** buttons | Footprint: 1×1 / 4×4 / 16×16 tiles |
| **SHADOWS** button (or **H**) | Toggle sun shadows (off skips the whole shadow pass — a free FPS win) |
| **STRESS** button (or **S**) | Randomize 5% of tiles every frame |
| **Drag** rotate · **Arrows** pan · **Z/X** or scroll zoom | camera |
| **1–5** | Grid size 64 / 256 / 1024 / 2048 / 4096 |

The HUD shows live draw calls, FPS + sparkline, grid/tile counts, live tree/building counts, and edits/sec.

## Notes & limits

- **Trees and buildings are 3D; the terrain stays flat** (the requested design).
- **No per-instance frustum culling (yet).** Each prop layer is one `InstancedMesh`, so all live instances are submitted every frame regardless of where the camera looks — FPS doesn't drop when you look at empty space. It's fine at these instance counts, but the proper optimization is **spatial chunking** (split props into a grid of chunks with per-chunk bounding spheres so off-screen chunks are culled). Not done here to keep the edit/pool model simple.
- **"120 fps" is vsync-bound.** If a machine shows an oddly low cap (e.g. exactly 30), suspect a power-saver rAF cap, a 30 Hz display mode, or Chrome using the integrated GPU instead of the discrete one (check `chrome://gpu`) — not the workload.
- The earlier **flat, single-draw-call, no-props** terrain (which scaled to 4096² at 1 draw call) is preserved in git history.

## Files

```
index.html                 self-contained app (import map + HUD + all logic/shaders inline)
test/drawcall.test.mjs     headless draw-call test (bounded & tile-count-independent)
package.json               npm test + serve scripts; three@0.184.0 devDependency
```
