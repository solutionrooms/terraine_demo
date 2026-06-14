// Headless one-draw-call verification (spec §9.1, AC-7).
//
// Mechanism: renderer.info.render.calls is incremented by three in JavaScript,
// not by the GPU. If render() completes against a *stub* WebGL2 context, the
// count is exactly what a browser reports. In Node, WebGLRenderingContext is
// undefined, so three's WebGL1 guard is skipped and it accepts any object as
// the context. We build the REAL scene structure (one Plane + the real
// ShaderMaterial + an R8 DataTexture) and assert calls === 1.
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

      let val;
      if (/^[A-Z0-9_]+$/.test(prop)) {
        // ALL_CAPS property -> a unique integer (a WebGL constant)
        val = counter++;
      } else {
        val = makeFn(prop);
      }
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
      case 'getActiveAttrib':  return () => null;
      case 'getParameter': return (pname) => {
        if (pname === gl.VERSION) return 'WebGL 2.0 (stub)';
        if (pname === gl.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00 (stub)';
        if (pname === gl.VENDOR || pname === gl.RENDERER) return 'stub';
        return 16384;                                  // large integer for any limit query
      };
      case 'getShaderPrecisionFormat':
        return () => ({ rangeMin: 127, rangeMax: 127, precision: 23 });
      case 'getContextAttributes': return () => ({});
      case 'getExtension': return () => null;
      case 'getError':     return () => 0;
      case 'createProgram':
      case 'createShader':
      case 'createBuffer':
      case 'createTexture':
      case 'createVertexArray':
      case 'createFramebuffer':
      case 'createRenderbuffer':
        return () => ({ __id: counter++ });            // non-null sentinel
      default:
        return () => {};                               // everything else: no-op
    }
  }

  return gl;
}

// Minimal canvas stub (three reads a few props / attaches listeners).
function makeCanvas(gl) {
  return {
    width: 1, height: 1, style: {},
    addEventListener() {}, removeEventListener() {},
    setAttribute() {}, getAttribute() { return null; },
    getContext() { return gl; },
  };
}

// ─── the REAL scene structure (mirrors index.html) ─────────────────────────────
const WORLD = 200;

const vertexShader = `
  precision highp float;
  uniform vec3 uCam;
  varying vec2 vWorld;
  varying float vDist;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    vDist  = distance(uCam, wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const fragmentShader = `
  precision highp float;
  uniform sampler2D uState;
  uniform float uN;
  uniform vec2  uOrigin;
  uniform float uWorld;
  uniform vec2  uHover;
  uniform vec3  uFog;
  uniform float uFogNear;
  uniform float uFogFar;
  varying vec2  vWorld;
  varying float vDist;
  void main() {
    vec2 uv = (vWorld - uOrigin) / uWorld;
    vec2 cell = uv * uN;
    float s = texture2D(uState, (floor(cell) + 0.5) / uN).r * 255.0;
    gl_FragColor = vec4(vec3(s, vDist, uHover.x + uFog.x + uFogNear + uFogFar), 1.0);
  }
`;

function buildScene(N) {
  const data = new Uint8Array(N * N);
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uState:   { value: tex },
      uN:       { value: N },
      uOrigin:  { value: new THREE.Vector2(-WORLD / 2, -WORLD / 2) },
      uWorld:   { value: WORLD },
      uHover:   { value: new THREE.Vector2(-1, -1) },
      uCam:     { value: new THREE.Vector3() },
      uFog:     { value: new THREE.Color(0x10131a) },
      uFogNear: { value: WORLD * 0.6 },
      uFogFar:  { value: WORLD * 2.2 },
    },
    vertexShader, fragmentShader,
  });
  material.extensions = { derivatives: true };

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;

  const scene = new THREE.Scene();
  scene.add(mesh);

  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 4000);
  camera.position.set(WORLD * 0.55, WORLD * 0.62, WORLD * 0.55);
  camera.lookAt(0, 0, 0);

  return { scene, camera, tex };
}

// ─── run ───────────────────────────────────────────────────────────────────────
let failed = false;
for (const N of [64, 4096]) {
  const gl = makeStubGL();
  const renderer = new THREE.WebGLRenderer({ canvas: makeCanvas(gl), context: gl, antialias: false });
  renderer.setSize(1280, 720, false);

  const { scene, camera } = buildScene(N);
  renderer.render(scene, camera);

  const calls = renderer.info.render.calls;
  const bytes = N * N;
  const vram = bytes >= 1048576 ? (bytes / 1048576).toFixed(2) + ' MB'
                                : (bytes / 1024).toFixed(1) + ' KB';
  const ok = calls === 1;
  console.log(
    `grid ${String(N).padEnd(4)}x${String(N).padEnd(4)} ` +
    `tiles ${String(N * N).padStart(9)}  ->  draw calls = ${calls}` +
    `   (R8 state tex = ${vram})  ${ok ? 'OK' : 'FAIL'}`
  );
  if (!ok) failed = true;
  renderer.dispose();
}

if (failed) {
  console.error('\nFAIL: at least one render produced != 1 draw call.');
  process.exit(1);
}
console.log('\nPASS: every scale renders the terrain in exactly 1 draw call.');
