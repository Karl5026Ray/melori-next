/**
 * Generates the five Concert battle instrument gifts as glTF 2.0 binary (.glb).
 *
 * These are deliberately hand-built low-poly parametric models rather than
 * imported artist assets: the gift tray needs five small, fast-loading 3D
 * objects that `model-viewer` can auto-rotate on a phone, and a checked-in
 * generator means the geometry is reviewable in source control instead of
 * arriving as an opaque binary.
 *
 * No dependencies — the glTF container is written by hand.
 *
 * Run:  npx tsx scripts/generate-instrument-glb.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = join(__dirname, "..", "public", "gifts");

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number];

interface Geometry {
  positions: number[];
  normals: number[];
  indices: number[];
}

function emptyGeometry(): Geometry {
  return { positions: [], normals: [], indices: [] };
}

function pushTriangle(
  geometry: Geometry,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  normal?: Vec3,
): void {
  const n = normal ?? faceNormal(a, b, c);
  const base = geometry.positions.length / 3;
  for (const vertex of [a, b, c]) {
    geometry.positions.push(vertex[0], vertex[1], vertex[2]);
    geometry.normals.push(n[0], n[1], n[2]);
  }
  geometry.indices.push(base, base + 1, base + 2);
}

function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

function pushQuad(geometry: Geometry, a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
  const n = faceNormal(a, b, c);
  pushTriangle(geometry, a, b, c, n);
  pushTriangle(geometry, a, c, d, n);
}

/** Axis-aligned box centred on `center`. */
function box(size: Vec3, center: Vec3 = [0, 0, 0]): Geometry {
  const geometry = emptyGeometry();
  const [sx, sy, sz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const [cx, cy, cz] = center;
  const p = (x: number, y: number, z: number): Vec3 => [cx + x * sx, cy + y * sy, cz + z * sz];
  // +Y, -Y, +X, -X, +Z, -Z
  pushQuad(geometry, p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1));
  pushQuad(geometry, p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1));
  pushQuad(geometry, p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1));
  pushQuad(geometry, p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1));
  pushQuad(geometry, p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1));
  pushQuad(geometry, p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1));
  return geometry;
}

/**
 * Cylinder along +Y. `radiusTop === 0` yields a cone. `scaleZ` squashes the
 * cross-section into an ellipse, which is how the guitar and violin bodies get
 * their flat profile without a separate primitive.
 */
function cylinder(opts: {
  radiusBottom: number;
  radiusTop?: number;
  height: number;
  segments?: number;
  center?: Vec3;
  scaleZ?: number;
  caps?: boolean;
}): Geometry {
  const geometry = emptyGeometry();
  const segments = opts.segments ?? 24;
  const radiusTop = opts.radiusTop ?? opts.radiusBottom;
  const scaleZ = opts.scaleZ ?? 1;
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];
  const halfHeight = opts.height / 2;
  const caps = opts.caps ?? true;

  const ring = (radius: number, y: number): Vec3[] =>
    Array.from({ length: segments }, (_, i) => {
      const theta = (i / segments) * Math.PI * 2;
      return [
        cx + Math.cos(theta) * radius,
        cy + y,
        cz + Math.sin(theta) * radius * scaleZ,
      ] as Vec3;
    });

  const bottom = ring(opts.radiusBottom, -halfHeight);
  const top = ring(radiusTop, halfHeight);
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    if (radiusTop === 0) {
      pushTriangle(geometry, bottom[i], bottom[j], top[i]);
    } else {
      pushQuad(geometry, bottom[i], bottom[j], top[j], top[i]);
    }
  }
  if (caps) {
    const bottomCenter: Vec3 = [cx, cy - halfHeight, cz];
    const topCenter: Vec3 = [cx, cy + halfHeight, cz];
    for (let i = 0; i < segments; i += 1) {
      const j = (i + 1) % segments;
      pushTriangle(geometry, bottomCenter, bottom[j], bottom[i], [0, -1, 0]);
      if (radiusTop > 0) pushTriangle(geometry, topCenter, top[i], top[j], [0, 1, 0]);
    }
  }
  return geometry;
}

/** Torus in the XZ plane, used for drum rims and the saxophone crook. */
function torus(opts: {
  radius: number;
  tube: number;
  arc?: number;
  startAngle?: number;
  segments?: number;
  tubeSegments?: number;
  center?: Vec3;
}): Geometry {
  const geometry = emptyGeometry();
  const segments = opts.segments ?? 24;
  const tubeSegments = opts.tubeSegments ?? 10;
  const arc = opts.arc ?? Math.PI * 2;
  const startAngle = opts.startAngle ?? 0;
  const [cx, cy, cz] = opts.center ?? [0, 0, 0];
  const point = (i: number, j: number): Vec3 => {
    const u = startAngle + (i / segments) * arc;
    const v = (j / tubeSegments) * Math.PI * 2;
    const r = opts.radius + opts.tube * Math.cos(v);
    return [cx + r * Math.cos(u), cy + opts.tube * Math.sin(v), cz + r * Math.sin(u)];
  };
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      pushQuad(geometry, point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1));
    }
  }
  return geometry;
}

function rotateX(geometry: Geometry, radians: number): Geometry {
  return transform(geometry, (x, y, z) => [
    x,
    y * Math.cos(radians) - z * Math.sin(radians),
    y * Math.sin(radians) + z * Math.cos(radians),
  ]);
}

function rotateZ(geometry: Geometry, radians: number): Geometry {
  return transform(geometry, (x, y, z) => [
    x * Math.cos(radians) - y * Math.sin(radians),
    x * Math.sin(radians) + y * Math.cos(radians),
    z,
  ]);
}

function translate(geometry: Geometry, offset: Vec3): Geometry {
  return transform(geometry, (x, y, z) => [x + offset[0], y + offset[1], z + offset[2]]);
}

function transform(
  geometry: Geometry,
  fn: (x: number, y: number, z: number) => Vec3,
): Geometry {
  const out: Geometry = { positions: [], normals: [...geometry.normals], indices: [...geometry.indices] };
  for (let i = 0; i < geometry.positions.length; i += 3) {
    const [x, y, z] = fn(
      geometry.positions[i],
      geometry.positions[i + 1],
      geometry.positions[i + 2],
    );
    out.positions.push(x, y, z);
  }
  // Normals are rotated by the same linear part; translation leaves them alone.
  const rotated: number[] = [];
  const origin = fn(0, 0, 0);
  for (let i = 0; i < geometry.normals.length; i += 3) {
    const [nx, ny, nz] = fn(
      geometry.normals[i],
      geometry.normals[i + 1],
      geometry.normals[i + 2],
    );
    const vx = nx - origin[0];
    const vy = ny - origin[1];
    const vz = nz - origin[2];
    const length = Math.hypot(vx, vy, vz) || 1;
    rotated.push(vx / length, vy / length, vz / length);
  }
  out.normals = rotated;
  return out;
}

function merge(...geometries: Geometry[]): Geometry {
  const out = emptyGeometry();
  for (const geometry of geometries) {
    const offset = out.positions.length / 3;
    out.positions.push(...geometry.positions);
    out.normals.push(...geometry.normals);
    out.indices.push(...geometry.indices.map((index) => index + offset));
  }
  return out;
}

// ---------------------------------------------------------------------------
// glTF / GLB writer
// ---------------------------------------------------------------------------

interface Material {
  name: string;
  color: [number, number, number];
  metallic: number;
  roughness: number;
}

interface Part {
  geometry: Geometry;
  material: Material;
}

function align4(value: number): number {
  return (4 - (value % 4)) % 4;
}

function writeGlb(parts: Part[], outPath: string): void {
  const buffers: Buffer[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const primitives: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  let byteOffset = 0;

  const addView = (data: Buffer, target: number): number => {
    const padding = align4(data.length);
    const padded = padding ? Buffer.concat([data, Buffer.alloc(padding)]) : data;
    buffers.push(padded);
    bufferViews.push({ buffer: 0, byteOffset, byteLength: data.length, target });
    byteOffset += padded.length;
    return bufferViews.length - 1;
  };

  parts.forEach((part, partIndex) => {
    const { positions, normals, indices } = part.geometry;
    const positionData = Buffer.from(new Float32Array(positions).buffer);
    const normalData = Buffer.from(new Float32Array(normals).buffer);
    const indexData = Buffer.from(new Uint32Array(indices).buffer);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }

    const positionView = addView(positionData, 34962);
    const normalView = addView(normalData, 34962);
    const indexView = addView(indexData, 34963);

    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: positions.length / 3,
      type: "VEC3",
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: normals.length / 3,
      type: "VEC3",
    });
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: indices.length,
      type: "SCALAR",
    });

    materials.push({
      name: part.material.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.material.color, 1],
        metallicFactor: part.material.metallic,
        roughnessFactor: part.material.roughness,
      },
      doubleSided: true,
    });

    primitives.push({
      attributes: { POSITION: partIndex * 3, NORMAL: partIndex * 3 + 1 },
      indices: partIndex * 3 + 2,
      material: partIndex,
    });
  });

  const binary = Buffer.concat(buffers);
  const gltf = {
    asset: { version: "2.0", generator: "melori-next scripts/generate-instrument-glb.ts" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
  };

  const jsonBuffer = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPadding = align4(jsonBuffer.length);
  const jsonChunk = Buffer.concat([jsonBuffer, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = align4(binary.length);
  const binChunk = Buffer.concat([binary, Buffer.alloc(binPadding)]);

  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);

  writeFileSync(
    outPath,
    Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]),
  );
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

const WOOD: Material = { name: "wood", color: [0.72, 0.4, 0.16], metallic: 0.05, roughness: 0.55 };
const DARK_WOOD: Material = { name: "darkWood", color: [0.26, 0.15, 0.08], metallic: 0.05, roughness: 0.6 };
const GOLD: Material = { name: "gold", color: [0.85, 0.63, 0.16], metallic: 0.95, roughness: 0.28 };
const IVORY: Material = { name: "ivory", color: [0.95, 0.94, 0.9], metallic: 0.02, roughness: 0.35 };
const EBONY: Material = { name: "ebony", color: [0.07, 0.07, 0.09], metallic: 0.05, roughness: 0.4 };
const CRIMSON: Material = { name: "crimson", color: [0.76, 0.18, 0.28], metallic: 0.1, roughness: 0.45 };
const CHROME: Material = { name: "chrome", color: [0.82, 0.84, 0.88], metallic: 0.9, roughness: 0.2 };
const ROSEWOOD: Material = { name: "rosewood", color: [0.55, 0.24, 0.12], metallic: 0.05, roughness: 0.5 };

/** A flat, guitar-like body: two overlapping squashed cylinders. */
function stringBody(upperRadius: number, lowerRadius: number, depth: number): Geometry {
  return merge(
    rotateX(
      cylinder({ radiusBottom: lowerRadius, height: depth, segments: 32, scaleZ: 0.92 }),
      Math.PI / 2,
    ),
    translate(
      rotateX(
        cylinder({ radiusBottom: upperRadius, height: depth, segments: 32, scaleZ: 0.92 }),
        Math.PI / 2,
      ),
      [0, lowerRadius * 0.95, 0],
    ),
  );
}

function guitar(): Part[] {
  return [
    { geometry: stringBody(0.34, 0.46, 0.2), material: WOOD },
    {
      geometry: merge(
        box([0.13, 1.0, 0.09], [0, 1.15, 0]),
        box([0.19, 0.24, 0.07], [0, 1.72, 0]),
      ),
      material: DARK_WOOD,
    },
    {
      geometry: merge(
        rotateX(cylinder({ radiusBottom: 0.17, height: 0.22, segments: 24 }), Math.PI / 2),
        box([0.3, 0.09, 0.13], [0, -0.42, 0]),
      ),
      material: EBONY,
    },
    {
      geometry: merge(
        ...[-0.045, -0.015, 0.015, 0.045].map((x) => box([0.012, 1.5, 0.012], [x, 0.75, 0.075])),
      ),
      material: CHROME,
    },
  ];
}

function violin(): Part[] {
  return [
    { geometry: stringBody(0.26, 0.34, 0.16), material: ROSEWOOD },
    {
      geometry: merge(
        box([0.1, 0.8, 0.07], [0, 0.9, 0]),
        // Scroll: a small squashed torus reads as a violin head at thumbnail size.
        translate(rotateX(torus({ radius: 0.09, tube: 0.035, segments: 18 }), Math.PI / 2), [0, 1.36, 0]),
      ),
      material: DARK_WOOD,
    },
    {
      geometry: merge(
        box([0.26, 0.05, 0.1], [0, -0.22, 0.06]),
        ...[-0.036, -0.012, 0.012, 0.036].map((x) => box([0.01, 1.15, 0.01], [x, 0.5, 0.06])),
      ),
      material: EBONY,
    },
    {
      geometry: rotateZ(box([0.035, 1.6, 0.035], [0, 0, 0]), 0.34),
      material: WOOD,
    },
  ];
}

function piano(): Part[] {
  const whiteKeys = merge(
    ...Array.from({ length: 10 }, (_, i) =>
      box([0.095, 0.06, 0.42], [-0.49 + i * 0.108, 0.06, 0.05]),
    ),
  );
  const blackKeys = merge(
    ...[-0.44, -0.33, -0.11, 0, 0.11, 0.33, 0.44].map((x) =>
      box([0.055, 0.05, 0.26], [x + 0.054, 0.11, -0.05]),
    ),
  );
  return [
    { geometry: merge(box([1.2, 0.3, 0.62], [0, -0.12, 0]), box([1.2, 0.16, 0.16], [0, 0.16, -0.28])), material: EBONY },
    { geometry: whiteKeys, material: IVORY },
    { geometry: blackKeys, material: { ...EBONY, name: "blackKeys", roughness: 0.25 } },
    {
      geometry: merge(
        ...[-0.5, 0.5].map((x) => cylinder({ radiusBottom: 0.05, height: 0.5, segments: 12, center: [x, -0.5, 0] })),
      ),
      material: DARK_WOOD,
    },
  ];
}

function drum(): Part[] {
  return [
    {
      geometry: cylinder({ radiusBottom: 0.55, height: 0.5, segments: 32, caps: false }),
      material: CRIMSON,
    },
    {
      geometry: merge(
        cylinder({ radiusBottom: 0.56, radiusTop: 0.56, height: 0.02, segments: 32, center: [0, 0.25, 0] }),
        cylinder({ radiusBottom: 0.56, radiusTop: 0.56, height: 0.02, segments: 32, center: [0, -0.25, 0] }),
      ),
      material: IVORY,
    },
    {
      geometry: merge(
        translate(torus({ radius: 0.56, tube: 0.035, segments: 32 }), [0, 0.26, 0]),
        translate(torus({ radius: 0.56, tube: 0.035, segments: 32 }), [0, -0.26, 0]),
      ),
      material: CHROME,
    },
    {
      // Sticks rest across the top head rather than through the shell, so the
      // drum silhouette stays readable while it rotates.
      geometry: merge(
        translate(
          rotateZ(cylinder({ radiusBottom: 0.028, height: 1.15, segments: 12 }), Math.PI / 2 - 0.34),
          [0, 0.36, 0.1],
        ),
        translate(
          rotateZ(cylinder({ radiusBottom: 0.028, height: 1.15, segments: 12 }), Math.PI / 2 + 0.34),
          [0, 0.36, -0.1],
        ),
      ),
      material: WOOD,
    },
  ];
}

function saxophone(): Part[] {
  // The crook is a quarter torus whose start point sits exactly on top of the
  // tapering body tube, so the neck reads as one continuous pipe into the
  // mouthpiece. The body opens downward into a cone bell.
  const crook = translate(
    rotateX(
      torus({
        radius: 0.26,
        tube: 0.058,
        arc: Math.PI / 2,
        startAngle: Math.PI,
        segments: 16,
      }),
      Math.PI / 2,
    ),
    [0.26, 0.6, 0],
  );
  return [
    {
      geometry: merge(
        cylinder({ radiusBottom: 0.085, radiusTop: 0.062, height: 1.25, segments: 20, center: [0, 0.0, 0] }),
        crook,
        translate(
          cylinder({ radiusBottom: 0.24, radiusTop: 0.09, height: 0.34, segments: 24 }),
          [0, -0.78, 0],
        ),
        translate(torus({ radius: 0.24, tube: 0.03, segments: 24 }), [0, -0.95, 0]),
      ),
      material: GOLD,
    },
    {
      geometry: merge(
        ...[0.34, 0.12, -0.1, -0.32].map((y) =>
          translate(
            rotateX(cylinder({ radiusBottom: 0.05, height: 0.035, segments: 12 }), Math.PI / 2),
            [0, y, 0.09],
          ),
        ),
      ),
      material: CHROME,
    },
    {
      geometry: translate(
        rotateZ(cylinder({ radiusBottom: 0.055, radiusTop: 0.032, height: 0.22, segments: 14 }), -0.5),
        [0.35, 0.93, 0],
      ),
      material: EBONY,
    },
  ];
}

const INSTRUMENTS: Record<string, () => Part[]> = {
  guitar,
  piano,
  drum,
  violin,
  saxophone,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(INSTRUMENTS)) {
  const outPath = join(OUT_DIR, `${name}.glb`);
  writeGlb(build(), outPath);
  console.log(`wrote ${outPath}`);
}
