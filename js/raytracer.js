// Ray tracer for gamma attenuation imaging
// Beer-Lambert law: I/I₀ = exp(-Σ μᵢ·Lᵢ)

import { getMaterial } from "./materials.js";

export class RayTracer {
  constructor(volumes, sources) {
    this.volumes = volumes;
    this.sources = sources;
    this.volDepth = {};
    this._buildHierarchy();
  }

  _buildHierarchy() {
    for (const vol of this.volumes) {
      if (vol.name === "world") this.volDepth[vol.name] = 0;
      else if (vol.mother) this.volDepth[vol.name] = 2;
      else this.volDepth[vol.name] = 1;
    }
  }

  computeDetectorImage(detector, resolution = 256) {
    if (!this.sources.length) {
      return { image: new Float32Array(resolution * resolution), nx: resolution, ny: resolution, extent: [0, 1, 0, 1] };
    }

    const source = this.sources[0];
    const srcPos = source.position;
    const detCenter = detector.translation;
    const detSize = detector.size;

    // Front face: closest to source along z
    const faceZ = detCenter[2] - detSize[2] / 2;
    const faceXSize = detSize[0];
    const faceYSize = detSize[1];

    // Resolution: longer dimension gets 'resolution' pixels
    let nx, ny;
    if (faceXSize >= faceYSize) {
      nx = resolution;
      ny = Math.max(128, Math.round(resolution * faceYSize / faceXSize));
    } else {
      ny = resolution;
      nx = Math.max(128, Math.round(resolution * faceXSize / faceYSize));
    }
    // Ensure odd so center is sampled
    if (nx % 2 === 0) nx++;
    if (ny % 2 === 0) ny++;

    const xs = linspace(detCenter[0] - faceXSize / 2, detCenter[0] + faceXSize / 2, nx);
    const ys = linspace(detCenter[1] - faceYSize / 2, detCenter[1] + faceYSize / 2, ny);

    const nRays = nx * ny;
    const origins = new Float64Array(nRays * 3);
    const directions = new Float64Array(nRays * 3);

    // Build ray arrays
    let idx = 0;
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const px = xs[ix], py = ys[iy], pz = faceZ;
        const dx = px - srcPos[0], dy = py - srcPos[1], dz = pz - srcPos[2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        origins[idx * 3] = srcPos[0];
        origins[idx * 3 + 1] = srcPos[1];
        origins[idx * 3 + 2] = srcPos[2];
        directions[idx * 3] = dx / len;
        directions[idx * 3 + 1] = dy / len;
        directions[idx * 3 + 2] = dz / len;
        idx++;
      }
    }

    const transmission = this._traceRays(origins, directions, nRays, new Set([detector.name]));

    return {
      image: transmission,
      nx, ny,
      extent: [xs[0], xs[nx - 1], ys[0], ys[ny - 1]],
    };
  }

  _traceRays(origins, directions, nRays, exclude) {
    const totalMuL = new Float64Array(nRays);

    const activeVolumes = this.volumes
      .filter(v => v.name !== "world" && !exclude.has(v.name))
      .sort((a, b) => (this.volDepth[a.name] || 1) - (this.volDepth[b.name] || 1));

    // Compute intersections for all volumes
    const volIntersections = activeVolumes.map(vol => {
      const { tEnter, tExit, hit } = this._intersectVolume(vol, origins, directions, nRays);
      return { vol, tEnter, tExit, hit };
    });

    // Accumulate attenuation with hierarchy handling
    for (let i = 0; i < volIntersections.length; i++) {
      const { vol, tEnter, tExit, hit } = volIntersections[i];
      const mat = getMaterial(vol.material);
      const mu = mat.mu_662;
      if (mu < 1e-6) continue;

      // Path length in mm
      const pathMm = new Float64Array(nRays);
      for (let r = 0; r < nRays; r++) {
        pathMm[r] = hit[r] ? tExit[r] - tEnter[r] : 0;
      }

      // Subtract child volume overlaps
      for (let j = 0; j < volIntersections.length; j++) {
        if (i === j) continue;
        const child = volIntersections[j];
        if (child.vol.mother === vol.name ||
            ((this.volDepth[child.vol.name] || 1) > (this.volDepth[vol.name] || 1) &&
             this._volumesOverlap(vol, child.vol))) {
          for (let r = 0; r < nRays; r++) {
            if (hit[r] && child.hit[r]) {
              const overlapEnter = Math.max(tEnter[r], child.tEnter[r]);
              const overlapExit = Math.min(tExit[r], child.tExit[r]);
              if (overlapExit > overlapEnter) {
                pathMm[r] -= (overlapExit - overlapEnter);
              }
            }
          }
        }
      }

      // mu is in cm⁻¹, path is in mm → convert
      for (let r = 0; r < nRays; r++) {
        if (pathMm[r] > 0) {
          totalMuL[r] += mu * Math.max(pathMm[r], 0) / 10.0;
        }
      }
    }

    // Beer-Lambert
    const transmission = new Float32Array(nRays);
    for (let r = 0; r < nRays; r++) {
      transmission[r] = Math.exp(-totalMuL[r]);
    }
    return transmission;
  }

  _volumesOverlap(a, b) {
    const ab = a.bounds();
    const bb = b.bounds();
    return bb[0] < ab[1] && bb[1] > ab[0] &&
           bb[2] < ab[3] && bb[3] > ab[2] &&
           bb[4] < ab[5] && bb[5] > ab[4];
  }

  _intersectVolume(vol, origins, directions, nRays) {
    if (vol.volType === "Sphere") {
      return raySphereintersect(origins, directions, nRays, vol.translation, vol.radius);
    }
    const b = vol.bounds();
    return rayBoxIntersect(origins, directions, nRays, [b[0], b[2], b[4]], [b[1], b[3], b[5]]);
  }
}

// Vectorized ray-AABB intersection (slab method)
function rayBoxIntersect(origins, directions, nRays, boxMin, boxMax) {
  const tEnter = new Float64Array(nRays);
  const tExit = new Float64Array(nRays);
  const hit = new Uint8Array(nRays);

  for (let r = 0; r < nRays; r++) {
    const i3 = r * 3;
    let tMin = -1e30, tMax = 1e30;

    for (let axis = 0; axis < 3; axis++) {
      const d = directions[i3 + axis];
      const o = origins[i3 + axis];
      if (Math.abs(d) > 1e-12) {
        const invD = 1.0 / d;
        let t1 = (boxMin[axis] - o) * invD;
        let t2 = (boxMax[axis] - o) * invD;
        if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
      } else {
        if (o < boxMin[axis] || o > boxMax[axis]) {
          tMin = 1e30; tMax = -1e30; // no hit
          break;
        }
      }
    }

    if (tMin < tMax && tMax > 1e-6) {
      hit[r] = 1;
      tEnter[r] = Math.max(tMin, 0);
      tExit[r] = tMax;
    }
  }

  return { tEnter, tExit, hit };
}

// Vectorized ray-sphere intersection (quadratic formula)
function raySphereintersect(origins, directions, nRays, center, radius) {
  const tEnter = new Float64Array(nRays);
  const tExit = new Float64Array(nRays);
  const hit = new Uint8Array(nRays);

  for (let r = 0; r < nRays; r++) {
    const i3 = r * 3;
    const lx = origins[i3] - center[0];
    const ly = origins[i3 + 1] - center[1];
    const lz = origins[i3 + 2] - center[2];
    const dx = directions[i3], dy = directions[i3 + 1], dz = directions[i3 + 2];

    const b = 2 * (lx * dx + ly * dy + lz * dz);
    const c = lx * lx + ly * ly + lz * lz - radius * radius;
    const disc = b * b - 4 * c;

    if (disc >= 0) {
      const sqrtDisc = Math.sqrt(disc);
      const t0 = (-b - sqrtDisc) / 2;
      const t1 = (-b + sqrtDisc) / 2;
      if (t1 > 1e-6) {
        hit[r] = 1;
        tEnter[r] = Math.max(t0, 0);
        tExit[r] = t1;
      }
    }
  }

  return { tEnter, tExit, hit };
}

function linspace(start, end, n) {
  const arr = new Float64Array(n);
  if (n === 1) { arr[0] = (start + end) / 2; return arr; }
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = start + i * step;
  return arr;
}
