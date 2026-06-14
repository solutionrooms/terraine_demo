# GPU Tile Grid — one-draw-call city-builder terrain (POC)

A flat, editable N×N tile grid that renders in **exactly one draw call** and whose
render cost is **independent of tile count** — the same code draws a 64×64 grid and a
4096×4096 (16.7M-tile) grid at the same cost.

It does this with **Tier 3** of the scaling model (spec §4.2): the grid is a **single
quad**, per-tile *state* lives in an **R8 `DataTexture`** (1 byte/tile), and a
`ShaderMaterial` fragment shader maps each pixel → tile → state → color. There are **no
per-tile JS objects** anywhere — that's the whole point ("rendering on GPU", and "JS
object allocation is the slow part"). Editing a tile uploads a **single texel**; picking
is **ray vs. the y=0 plane**, so both are O(1).

## Run

ES modules + an import map require HTTP — browsers block module scripts on `file://`,
so you must serve the folder (you can't double-click `index.html`):

```bash
npm run serve          # python3 -m http.server 8080
# then open http://localhost:8080/
```

Any static server works (`npx serve`, `php -S`, etc.). No build step, no bundler.
Three.js is loaded from a pinned CDN (`three@0.184.0`) via the import map in `index.html`.

## Test (headless, no GPU)

```bash
npm install            # fetches three@0.184.0 as a devDependency (test only)
npm test               # node test/drawcall.test.mjs
```

Asserts `renderer.info.render.calls === 1` for N ∈ {64, 4096} against a stubbed WebGL2
context (spec §9.1 / AC-7). `render.calls` is incremented by three in JS, not the GPU,
so the count is exactly what a browser reports. Exits non-zero if any count ≠ 1.

Expected output:

```
grid 64  x64   tiles      4096  ->  draw calls = 1   (R8 state tex = 4.0 KB)  OK
grid 4096x4096 tiles  16777216  ->  draw calls = 1   (R8 state tex = 16.00 MB)  OK
PASS: every scale renders the terrain in exactly 1 draw call.
```

## Controls

| Input | Action |
|-------|--------|
| **Left-click** a tile | Build / clear a road (toggles ROAD ↔ the natural tile underneath) |
| **Drag** | Orbit the camera (a drag > 5 px is never treated as a click) |
| **Scroll** | Zoom |
| **1–5** or HUD buttons | Switch grid scale: 64 / 256 / 1024 / 2048 / 4096 |
| **R** | Reset all tiles to the natural terrain |
| **B** | Benchmark — render N frames outside vsync, report ms/frame headroom |

The HUD (top-left) shows live **draw calls** (green when 1), **FPS** + a frame-time
sparkline (with the 8.33 ms / 120 Hz budget line), **grid size**, **tile count**,
**state VRAM** (= N·N bytes), and the **hovered tile**.

## In-browser checks (spec §9.2)

- HUD draw-calls reads **1** while orbiting and after editing.
- Cycling N 64→4096 keeps draw-calls at 1 and FPS roughly flat (scale-independence).
- A click lands on the exact tile under the cursor even at a steep oblique angle.
- Chrome DevTools allocation profiler shows no per-frame garbage while idle / orbiting /
  hovering (the render loop only copies a reused vector; HUD text is throttled to ~5 Hz).

## Known limits

- **Flat grid — no relief, no shadows.** A flat quad has uniform up-normals and nothing
  to self-shadow; lighting would be a constant factor and a shadow map is a *second*
  render pass that would break the one-draw-call invariant. Colors + analytic AA
  gridlines + distance fog carry the look (spec §4.3). **Adding height means leaving this
  tier** (per-instance/geometry height), which is a different architecture.
- **Far-field shimmer at high N** (spec P-7): the state texture is sampled NEAREST with no
  mipmaps (you must never mipmap an *index* texture — averaging state enums yields
  garbage), so at 4096² many tiles fall under one pixel. The gridlines fade with distance
  to mask it. A proper fix (mip-mapped *color* LODs or screen-space supersampling) is
  future work.
- **"120 fps" is vsync-bound.** `requestAnimationFrame` caps at the display refresh; use
  **B** (benchmark mode) to measure true headroom above vsync.

## Files

```
index.html                 self-contained app (import map + HUD + all logic/shaders inline)
test/drawcall.test.mjs     headless one-draw-call verification (no GPU)
package.json               npm test + serve scripts; three@0.184.0 devDependency
```
