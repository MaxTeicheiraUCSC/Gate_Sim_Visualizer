import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { GeometryExtractor } from "./parser.js";
import { RayTracer } from "./raytracer.js";
import { getMaterial } from "./materials.js";

const DEFAULT_SCRIPT = "scripts/czt_slit_simulation_cluster.py";
const FALLBACK_URL = "https://raw.githubusercontent.com/maxteicheiraUCSC/gate_sim/main/czt_slit_simulation_cluster.py";

let scene, camera, renderer, controls;
let projectionGroup = null;
let projectionVisible = true;
let currentVolumes = [];
let currentSources = [];

// ── UI ──────────────────────────────────────────────────────
const urlInput = document.getElementById("url-input");
const scriptInput = document.getElementById("script-input");
const loadUrlBtn = document.getElementById("load-url");
const loadScriptBtn = document.getElementById("load-script");
const toggleProjBtn = document.getElementById("toggle-projection");
const statusEl = document.getElementById("status");
const infoPanel = document.getElementById("info-panel");
const resolutionInput = document.getElementById("resolution");

function setStatus(msg) { statusEl.textContent = msg; }

// ── Three.js setup ──────────────────────────────────────────
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);

  renderer = new THREE.WebGLRenderer({ antialias: true, canvas: document.getElementById("viewport") });
  renderer.setPixelRatio(window.devicePixelRatio);
  resizeRenderer();

  camera = new THREE.PerspectiveCamera(50, renderer.domElement.width / renderer.domElement.height, 0.1, 100000);
  controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 2.0;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.8;
  controls.dynamicDampingFactor = 0.15;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 200, 300);
  scene.add(dirLight);

  window.addEventListener("resize", () => {
    resizeRenderer();
    camera.aspect = renderer.domElement.width / renderer.domElement.height;
    camera.updateProjectionMatrix();
    controls.handleResize();
  });

  animate();
}

function resizeRenderer() {
  const container = document.getElementById("canvas-container");
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ── Clear scene ─────────────────────────────────────────────
function clearScene() {
  while (scene.children.length > 0) {
    const obj = scene.children[0];
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
    scene.remove(obj);
  }
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 200, 300);
  scene.add(dirLight);
  projectionGroup = null;
}

// ── Build 3D scene from parsed data ─────────────────────────
function buildScene(volumes, sources) {
  clearScene();
  currentVolumes = volumes;
  currentSources = sources;

  // Draw volumes
  for (const vol of volumes) {
    if (vol.name === "world") continue;
    const mat = getMaterial(vol.material);
    const color = new THREE.Color(mat.color[0], mat.color[1], mat.color[2]);

    let mesh;
    if (vol.volType === "Sphere") {
      const geom = new THREE.SphereGeometry(vol.radius, 32, 32);
      const material = new THREE.MeshPhongMaterial({
        color, transparent: true, opacity: mat.opacity,
        side: THREE.DoubleSide, depthWrite: mat.opacity > 0.5,
      });
      mesh = new THREE.Mesh(geom, material);
      mesh.position.set(...vol.translation);
    } else {
      const geom = new THREE.BoxGeometry(vol.size[0], vol.size[1], vol.size[2]);

      // Air/slit volumes inside a parent: wireframe
      if ((vol.material === "G4_AIR" || vol.material === "G4_Galactic") && vol.mother) {
        const material = new THREE.MeshBasicMaterial({
          color: 0xffff00, wireframe: true, transparent: true, opacity: 0.6,
        });
        mesh = new THREE.Mesh(geom, material);
      } else {
        const material = new THREE.MeshPhongMaterial({
          color, transparent: true, opacity: mat.opacity,
          side: THREE.DoubleSide, depthWrite: mat.opacity > 0.5,
        });
        mesh = new THREE.Mesh(geom, material);

        // Add edges for solid boxes
        if (mat.opacity > 0.1) {
          const edges = new THREE.EdgesGeometry(geom);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
          const wireframe = new THREE.LineSegments(edges, lineMat);
          mesh.add(wireframe);
        }
      }
      mesh.position.set(...vol.translation);
    }

    mesh.userData.volumeName = vol.name;
    scene.add(mesh);
  }

  // Draw source
  if (sources.length > 0) {
    const src = sources[0];
    const geom = new THREE.SphereGeometry(1.5, 16, 16);
    const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(...src.position);
    scene.add(mesh);

    // Glow sprite
    const spriteMat = new THREE.SpriteMaterial({
      color: 0xff4400, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(8, 8, 1);
    sprite.position.set(...src.position);
    scene.add(sprite);
  }

  // Set camera
  setupCamera(volumes, sources);

  // Update info panel
  updateInfoPanel(volumes, sources);

  // Compute projection
  projectionVisible = true;
  toggleProjBtn.textContent = "Hide Projection";
  computeProjection(volumes, sources);
}

// ── Camera ──────────────────────────────────────────────────
function setupCamera(volumes, sources) {
  let allZ = [], allXY = [];
  for (const vol of volumes) {
    if (vol.name === "world") continue;
    const b = vol.bounds();
    allXY.push(Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3]));
    allZ.push(b[4], b[5]);
  }
  for (const src of sources) {
    allZ.push(src.position[2]);
    allXY.push(Math.abs(src.position[0]), Math.abs(src.position[1]));
  }

  if (!allZ.length) return;

  const zMin = Math.min(...allZ), zMax = Math.max(...allZ);
  const zMid = (zMin + zMax) / 2;
  const zSpan = zMax - zMin;
  const xyMax = allXY.length ? Math.max(...allXY) : 50;

  const camDist = Math.max(zSpan, xyMax * 2) * 1.2;
  camera.position.set(camDist * 0.7, -camDist * 0.5, zMid - zSpan * 0.15);
  controls.target.set(0, 0, zMid);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, zMid);
  controls.update();
}

// ── Projection ──────────────────────────────────────────────
function computeProjection(volumes, sources) {
  const detectors = findDetectors(volumes);
  if (!detectors.length || !sources.length) {
    setStatus("Ready (no detector found for projection)");
    return;
  }

  const resolution = parseInt(resolutionInput.value) || 256;
  setStatus("Computing attenuation image...");

  // Use setTimeout to let the UI update before heavy computation
  setTimeout(() => {
    const rayTracer = new RayTracer(volumes, sources);
    projectionGroup = new THREE.Group();
    projectionGroup.name = "projection";

    for (const det of detectors) {
      const { image, nx, ny, extent } = rayTracer.computeDetectorImage(det, resolution);

      // Create canvas texture from transmission data
      const canvas = document.createElement("canvas");
      canvas.width = nx;
      canvas.height = ny;
      const ctx = canvas.getContext("2d");
      const imgData = ctx.createImageData(nx, ny);

      // Inferno-like colormap
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          // Flip Y so image[0] (y_min) is at bottom of texture
          const srcIdx = (ny - 1 - iy) * nx + ix;
          const t = image[srcIdx];
          const [cr, cg, cb] = inferno(t);
          const dstIdx = (iy * nx + ix) * 4;
          imgData.data[dstIdx] = cr;
          imgData.data[dstIdx + 1] = cg;
          imgData.data[dstIdx + 2] = cb;
          imgData.data[dstIdx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;

      // Place the image plane in front of the detector face
      const detCenter = det.translation;
      const detSize = det.size;
      const faceZ = detCenter[2] - detSize[2] / 2;
      const screenOffset = Math.max(3.0, Math.max(detSize[0], detSize[1]) * 0.03);
      const screenZ = faceZ - screenOffset;

      const planeGeom = new THREE.PlaneGeometry(detSize[0], detSize[1]);
      const planeMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
      const planeMesh = new THREE.Mesh(planeGeom, planeMat);
      planeMesh.position.set(detCenter[0], detCenter[1], screenZ);
      projectionGroup.add(planeMesh);

      // Border
      const borderGeom = new THREE.EdgesGeometry(new THREE.BoxGeometry(detSize[0], detSize[1], 0.2));
      const borderMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
      const border = new THREE.LineSegments(borderGeom, borderMat);
      border.position.set(detCenter[0], detCenter[1], screenZ);
      projectionGroup.add(border);

      // Draw sample rays
      drawSampleRays(projectionGroup, rayTracer, det);

      // Stats
      let min = 1, max = 0, sum = 0;
      for (let i = 0; i < image.length; i++) {
        if (image[i] < min) min = image[i];
        if (image[i] > max) max = image[i];
        sum += image[i];
      }
      setStatus(`Ready | ${nx}x${ny}px | T: ${min.toFixed(4)} - ${max.toFixed(4)} (mean ${(sum / image.length).toFixed(4)})`);
    }

    scene.add(projectionGroup);
  }, 50);
}

function drawSampleRays(group, rayTracer, detector) {
  if (!currentSources.length) return;
  const src = currentSources[0];
  const srcPos = new THREE.Vector3(...src.position);
  const detCenter = detector.translation;
  const detSize = detector.size;
  const faceZ = detCenter[2] - detSize[2] / 2;

  const nRays = 40;
  const nRows = 5;
  const xs = linspaceArr(detCenter[0] - detSize[0] / 2, detCenter[0] + detSize[0] / 2, nRays);
  const ys = linspaceArr(detCenter[1] - detSize[1] / 2, detCenter[1] + detSize[1] / 2, nRows);

  // Build rays for transmission check
  const totalRays = nRays * nRows;
  const origins = new Float64Array(totalRays * 3);
  const directions = new Float64Array(totalRays * 3);
  const endpoints = [];

  let idx = 0;
  for (const y of ys) {
    for (const x of xs) {
      const dx = x - src.position[0], dy = y - src.position[1], dz = faceZ - src.position[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      origins[idx * 3] = src.position[0]; origins[idx * 3 + 1] = src.position[1]; origins[idx * 3 + 2] = src.position[2];
      directions[idx * 3] = dx / len; directions[idx * 3 + 1] = dy / len; directions[idx * 3 + 2] = dz / len;
      endpoints.push(new THREE.Vector3(x, y, faceZ));
      idx++;
    }
  }

  const transmission = rayTracer._traceRays(origins, directions, totalRays, new Set([detector.name]));

  for (let i = 0; i < totalRays; i++) {
    const t = transmission[i];
    let color, opacity, lineWidth;
    if (t > 0.5) { color = 0xffff33; opacity = 0.5; }
    else if (t > 0.1) { color = 0xff9900; opacity = 0.3; }
    else if (t > 0.01) { color = 0xcc3300; opacity = 0.1; }
    else { color = 0x330000; opacity = 0.03; }

    // Only draw a subset of dim rays
    if (t <= 0.3 && Math.random() > 0.15) continue;

    const geom = new THREE.BufferGeometry().setFromPoints([srcPos, endpoints[i]]);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    group.add(new THREE.Line(geom, mat));
  }
}

function findDetectors(volumes) {
  return volumes.filter(v => {
    if (v.name === "world") return false;
    return v.name.toLowerCase().includes("detector") ||
           ["CdZnTe", "G4_Si", "G4_Ge"].includes(v.material);
  });
}

// ── Info panel ───────────────────────────────────────────────
function updateInfoPanel(volumes, sources) {
  let html = "<h3>Geometry</h3>";
  for (const vol of volumes) {
    if (vol.name === "world") continue;
    const mat = getMaterial(vol.material);
    const sizeStr = vol.volType === "Sphere"
      ? `r=${vol.radius.toFixed(1)} mm`
      : vol.size.map(s => s.toFixed(1)).join(" x ") + " mm";
    const posStr = vol.translation.map(p => p.toFixed(1)).join(", ");
    const colorHex = `rgb(${Math.round(mat.color[0] * 255)},${Math.round(mat.color[1] * 255)},${Math.round(mat.color[2] * 255)})`;
    html += `<div class="vol-entry">
      <span class="vol-swatch" style="background:${colorHex}"></span>
      <strong>${vol.name}</strong>: ${sizeStr}<br>
      <small>&nbsp;&nbsp;${mat.label} | pos: (${posStr})</small>
    </div>`;
  }

  if (sources.length) {
    html += "<h3>Sources</h3>";
    for (const src of sources) {
      const posStr = src.position.map(p => p.toFixed(1)).join(", ");
      html += `<div class="vol-entry">
        <span class="vol-swatch" style="background:#ff0000"></span>
        <strong>${src.name}</strong>: ${src.particle} ${src.energyKeV.toFixed(0)} keV<br>
        <small>&nbsp;&nbsp;pos: (${posStr})</small>
      </div>`;
    }
  }

  infoPanel.innerHTML = html;
}

// ── Inferno colormap approximation ──────────────────────────
function inferno(t) {
  t = Math.max(0, Math.min(1, t));
  // Simplified inferno: black -> purple -> red -> yellow -> white
  let r, g, b;
  if (t < 0.25) {
    const s = t / 0.25;
    r = Math.round(s * 80);
    g = Math.round(s * 18);
    b = Math.round(s * 120 + 4);
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = Math.round(80 + s * 140);
    g = Math.round(18 + s * 30);
    b = Math.round(124 - s * 70);
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = Math.round(220 + s * 32);
    g = Math.round(48 + s * 130);
    b = Math.round(54 - s * 44);
  } else {
    const s = (t - 0.75) / 0.25;
    r = Math.round(252 + s * 3);
    g = Math.round(178 + s * 77);
    b = Math.round(10 + s * 90);
  }
  return [r, g, b];
}

function linspaceArr(start, end, n) {
  const arr = [];
  if (n === 1) { arr.push((start + end) / 2); return arr; }
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) arr.push(start + i * step);
  return arr;
}

// ── Load handlers ───────────────────────────────────────────
async function loadFromUrl(url) {
  setStatus("Fetching script...");
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    parseAndBuild(text);
  } catch (e) {
    setStatus(`Error fetching: ${e.message}`);
  }
}

function parseAndBuild(scriptText) {
  setStatus("Parsing script...");
  const extractor = new GeometryExtractor();
  const { volumes, sources } = extractor.extract(scriptText);

  if (!volumes.length) {
    setStatus("Error: no volumes found in script.");
    return;
  }

  const nonWorld = volumes.filter(v => v.name !== "world");
  setStatus(`Parsed ${nonWorld.length} volumes, ${sources.length} sources. Building scene...`);
  buildScene(volumes, sources);
}

// ── Event listeners ─────────────────────────────────────────
loadUrlBtn.addEventListener("click", () => {
  const url = urlInput.value.trim();
  if (url) loadFromUrl(url);
});

urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadUrlBtn.click();
});

loadScriptBtn.addEventListener("click", () => {
  const text = scriptInput.value.trim();
  if (text) parseAndBuild(text);
});

toggleProjBtn.addEventListener("click", () => {
  if (!projectionGroup) return;
  projectionVisible = !projectionVisible;
  projectionGroup.visible = projectionVisible;
  toggleProjBtn.textContent = projectionVisible ? "Hide Projection" : "Show Projection";
});

// ── Init ────────────────────────────────────────────────────
initScene();
urlInput.value = FALLBACK_URL;

// Try local bundled script first (from GitHub Actions), fall back to raw URL
(async () => {
  try {
    const resp = await fetch(DEFAULT_SCRIPT);
    if (!resp.ok) throw new Error("not bundled");
    const text = await resp.text();
    setStatus("Loaded bundled script");
    parseAndBuild(text);
  } catch {
    loadFromUrl(FALLBACK_URL);
  }
})();
