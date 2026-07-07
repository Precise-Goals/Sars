import { readFileSync } from "fs";

const glbPath = "d:/Workspace/Projects/Sars/assets/industry.glb";

// ── Matrix helper functions ──
function compose(translation: number[] | undefined, rotation: number[] | undefined, scale: number[] | undefined): number[] {
  const te = new Array(16).fill(0);
  te[15] = 1;
  
  const x = rotation ? rotation[0] : 0;
  const y = rotation ? rotation[1] : 0;
  const z = rotation ? rotation[2] : 0;
  const w = rotation ? (rotation[3] !== undefined ? rotation[3] : 1) : 1;
  
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  
  const sx = scale ? scale[0] : 1;
  const sy = scale ? scale[1] : 1;
  const sz = scale ? scale[2] : 1;
  
  te[0] = (1 - (yy + zz)) * sx;
  te[1] = (xy + wz) * sx;
  te[2] = (xz - wy) * sx;
  te[3] = 0;
  
  te[4] = (xy - wz) * sy;
  te[5] = (1 - (xx + zz)) * sy;
  te[6] = (yz + wx) * sy;
  te[7] = 0;
  
  te[8] = (xz + wy) * sz;
  te[9] = (yz - wx) * sz;
  te[10] = (1 - (xx + yy)) * sz;
  te[11] = 0;
  
  te[12] = translation ? translation[0] : 0;
  te[13] = translation ? translation[1] : 0;
  te[14] = translation ? translation[2] : 0;
  
  return te;
}

function multiplyMatrices(a: number[], b: number[]): number[] {
  const ae = a;
  const be = b;
  const te = new Array(16);

  const a11 = ae[ 0 ], a12 = ae[ 4 ], a13 = ae[ 8 ], a14 = ae[ 12 ];
  const a21 = ae[ 1 ], a22 = ae[ 5 ], a23 = ae[ 9 ], a24 = ae[ 13 ];
  const a31 = ae[ 2 ], a32 = ae[ 6 ], a33 = ae[ 10 ], a34 = ae[ 14 ];
  const a41 = ae[ 3 ], a42 = ae[ 7 ], a43 = ae[ 11 ], a44 = ae[ 15 ];

  const b11 = be[ 0 ], b12 = be[ 4 ], b13 = be[ 8 ], b14 = be[ 12 ];
  const b21 = be[ 1 ], b22 = be[ 5 ], b23 = be[ 9 ], b24 = be[ 13 ];
  const b31 = be[ 2 ], b32 = be[ 6 ], b33 = be[ 10 ], b34 = be[ 14 ];
  const b41 = be[ 3 ], b42 = be[ 7 ], b43 = be[ 11 ], b44 = be[ 15 ];

  te[ 0 ] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
  te[ 4 ] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
  te[ 8 ] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
  te[ 12 ] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

  te[ 1 ] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
  te[ 5 ] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
  te[ 9 ] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
  te[ 13 ] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

  te[ 2 ] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
  te[ 6 ] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
  te[ 10 ] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
  te[ 14 ] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

  te[ 3 ] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
  te[ 7 ] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
  te[ 11 ] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
  te[ 15 ] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

  return te;
}

function transformPoint(p: number[], m: number[]): number[] {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const wInv = 1 / (w || 1);
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * wInv,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * wInv,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * wInv
  ];
}

const IDENTITY = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1
];

function run() {
  const buffer = readFileSync(glbPath);
  const chunk0Length = buffer.readUInt32LE(12);
  const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
  const gltf = JSON.parse(jsonStr);

  const bounds: Array<{ name: string; minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number }> = [];

  function traverse(nodeIdx: number, parentMatrix: number[]) {
    const node = gltf.nodes[nodeIdx];
    let localMatrix = IDENTITY;
    if (node.matrix) {
      localMatrix = node.matrix;
    } else {
      localMatrix = compose(node.translation, node.rotation, node.scale);
    }
    const worldMatrix = multiplyMatrices(parentMatrix, localMatrix);

    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      mesh.primitives.forEach((prim: any) => {
        if (prim.attributes && prim.attributes.POSITION !== undefined) {
          const accessor = gltf.accessors[prim.attributes.POSITION];
          if (accessor.min && accessor.max) {
            const min = accessor.min;
            const max = accessor.max;
            
            // Generate 8 corners of the local bounding box
            const corners = [
              [min[0], min[1], min[2]],
              [min[0], min[1], max[2]],
              [min[0], max[1], min[2]],
              [min[0], max[1], max[2]],
              [max[0], min[1], min[2]],
              [max[0], min[1], max[2]],
              [max[0], max[1], min[2]],
              [max[0], max[1], max[2]]
            ];
            
            // Transform corners to world coordinates
            const worldCorners = corners.map(c => transformPoint(c, worldMatrix));
            
            // Compute AABB in world space
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            let minZ = Infinity, maxZ = -Infinity;
            
            worldCorners.forEach(c => {
              if (c[0] < minX) minX = c[0];
              if (c[0] > maxX) maxX = c[0];
              if (c[1] < minY) minY = c[1];
              if (c[1] > maxY) maxY = c[1];
              if (c[2] < minZ) minZ = c[2];
              if (c[2] > maxZ) maxZ = c[2];
            });
            
            bounds.push({
              name: node.name || mesh.name || "Obstacle",
              minX, maxX, minY, maxY, minZ, maxZ
            });
          }
        }
      });
    }

    if (node.children) {
      node.children.forEach((childIdx: number) => {
        traverse(childIdx, worldMatrix);
      });
    }
  }

  // Start traversal from root nodes of scene
  const scene = gltf.scenes[gltf.scene || 0];
  scene.nodes.forEach((nodeIdx: number) => {
    traverse(nodeIdx, IDENTITY);
  });

  console.log(`Successfully calculated AABBs for ${bounds.length} geometries.`);
  console.log("\nSome example bounds:");
  bounds.slice(0, 30).forEach((b, i) => {
    console.log(`${i}: ${b.name} -> X: [${b.minX.toFixed(2)}, ${b.maxX.toFixed(2)}] Y: [${b.minY.toFixed(2)}, ${b.maxY.toFixed(2)}] Z: [${b.minZ.toFixed(2)}, ${b.maxZ.toFixed(2)}]`);
  });

  // Calculate the overall map boundaries
  let overallMinX = Infinity, overallMaxX = -Infinity;
  let overallMinY = Infinity, overallMaxY = -Infinity;
  let overallMinZ = Infinity, overallMaxZ = -Infinity;
  bounds.forEach(b => {
    if (b.minX < overallMinX) overallMinX = b.minX;
    if (b.maxX > overallMaxX) overallMaxX = b.maxX;
    if (b.minY < overallMinY) overallMinY = b.minY;
    if (b.maxY > overallMaxY) overallMaxY = b.maxY;
    if (b.minZ < overallMinZ) overallMinZ = b.minZ;
    if (b.maxZ > overallMaxZ) overallMaxZ = b.maxZ;
  });

  console.log("\nOverall Map Bounding Box:");
  console.log(`X: [${overallMinX.toFixed(2)}, ${overallMaxX.toFixed(2)}]`);
  console.log(`Y: [${overallMinY.toFixed(2)}, ${overallMaxY.toFixed(2)}]`);
  console.log(`Z: [${overallMinZ.toFixed(2)}, ${overallMaxZ.toFixed(2)}]`);
}

run();
