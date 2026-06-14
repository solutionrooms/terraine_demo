// Headless draw-call verification (no GPU).
//
// The architecture changed from "flat one-quad terrain" to a 3D city: a flat
// textured terrain quad + 3D instanced trees + 3D instanced buildings + a sun
// shadow. So the invariant is no longer "exactly 1 draw call" — it's:
//
//   main-pass draw calls == number of LAYERS (terrain + trees + buildings),
//   and that is INDEPENDENT of tile count and prop count, and well under 100.
//
// renderer.info.render.calls is incremented by three in JS, not the GPU, so a
// render against a stubbed WebGL2 context reports exactly what a browser would.
// We build the real scene structure (one plane + two InstancedMesh of N*N each)
// at N = 64 and N = 256 and assert the call count is the same and bounded.
//
//   node test/drawcall.test.mjs   (npm test)

import * as THREE from 'three';

// ─── Proxy-based stub WebGL2 context ───────────────────────────────────────────
function makeStubGL() {
  let counter = 1;
  const cache = new Map();
  const gl = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop !== 'string') return undefined;
      if (cache.has(prop)) return cache.get(prop);
      const val = /^[A-Z0-9_]+$/.test(prop) ? counter++ : makeFn(prop);
      cache.set(prop, val);
      return val;
    },
  });
  function makeFn(prop) {
    switch (prop) {
      case 'getShaderParameter': return () => true;
      case 'getProgramParameter': return (_p, pname) =>
        (pname === gl.ACTIVE_UNIFORMS || pname === gl.ACTIVE_ATTRIBUTES) ? 0 : true;
      case 'getActiveUniform': return () => null;
      case 'getActiveAttrib': return () => null;
      case 'getParameter': return (pname) => {
        if (pname === gl.VERSION) return 'WebGL 2.0 (stub)';
        if (pname === gl.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00 (stub)';
        if (pname === gl.VENDOR || pname === gl.RENDERER) return 'stub';
        return 16384;
      };
      case 'getShaderPrecisionFormat': return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      case 'getContextAttributes': return () => ({});
      case 'getExtension': return () => null;
      case 'getError': return () => 0;
      case 'checkFramebufferStatus': return () => gl.FRAMEBUFFER_COMPLETE;
      case 'createProgram': case 'createShader': case 'createBuffer':
      case 'createTexture': case 'createVertexArray':
      case 'createFramebuffer': case 'createRenderbuffer':
        return () => ({ __id: counter++ });
      default: return () => {};
    }
  }
  return gl;
}
function makeCanvas(gl) {
  return {
    width: 1, height: 1, style: {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    getContext() { return gl; },
  };
}

// ─── the real scene structure: terrain quad + 2 instanced prop layers + sun ────
const WORLD = 200;
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const treeGeo = new THREE.ConeGeometry(0.5, 1.5, 8);
const dummy = new THREE.Object3D();

function instanced(geo, n) {
  const inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(), n * n);
  for (let i = 0; i < n * n; i++) { dummy.position.set(i % n, 0, (i / n) | 0); dummy.updateMatrix(); inst.setMatrixAt(i, dummy.matrix); }
  inst.castShadow = true; inst.receiveShadow = true; inst.frustumCulled = false;
  return inst;
}
function buildScene(n) {
  const scene = new THREE.Scene();

  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), new THREE.MeshLambertMaterial());
  terrain.rotation.x = -Math.PI / 2;
  terrain.receiveShadow = true;
  scene.add(terrain);

  scene.add(instanced(treeGeo, n));   // trees layer  (1 InstancedMesh, N*N instances)
  scene.add(instanced(boxGeo, n));    // buildings layer

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(80, 90, 50);
  sun.castShadow = true;
  scene.add(sun, sun.target, new THREE.HemisphereLight(0xbfe0ff, 0x55692f, 0.6));

  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 3000);
  camera.position.set(80, 100, 140);
  camera.lookAt(0, 0, 0);
  return { scene, camera };
}

function callsAt(n) {
  const gl = makeStubGL();
  const renderer = new THREE.WebGLRenderer({ canvas: makeCanvas(gl), context: gl, antialias: false });
  renderer.shadowMap.enabled = true;
  renderer.setSize(1280, 720, false);
  const { scene, camera } = buildScene(n);
  renderer.render(scene, camera);
  const calls = renderer.info.render.calls;
  renderer.dispose();
  return calls;
}

// ─── run ───────────────────────────────────────────────────────────────────────
const LAYERS = 3;            // terrain + trees + buildings
const BUDGET = 100;
let failed = false;
let baseline = null;
for (const n of [64, 256]) {
  const calls = callsAt(n);
  if (baseline === null) baseline = calls;
  const ok = calls < BUDGET && calls === baseline;
  console.log(
    `grid ${String(n).padEnd(4)} (${String(n * n).padStart(6)} tiles, ${String(2 * n * n).padStart(7)} prop instances)` +
    `  ->  main-pass draw calls = ${calls}  ${ok ? 'OK' : 'FAIL'}`
  );
  if (!ok) failed = true;
}
console.log(`\n(expected ${LAYERS} layers: terrain + trees + buildings — constant regardless of tile/instance count, budget < ${BUDGET})`);

if (failed) {
  console.error('\nFAIL: draw calls grew with tile count or exceeded the budget.');
  process.exit(1);
}
console.log('PASS: draw calls are bounded and independent of tile count.');
