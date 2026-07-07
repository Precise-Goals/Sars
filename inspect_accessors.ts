import { readFileSync } from "fs";

const glbPath = "d:/Workspace/Projects/Sars/assets/industry.glb";

function inspectAccessors() {
  const buffer = readFileSync(glbPath);
  const chunk0Length = buffer.readUInt32LE(12);
  const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
  const gltf = JSON.parse(jsonStr);

  console.log("Accessors count:", gltf.accessors?.length);
  if (gltf.accessors && gltf.accessors.length > 0) {
    console.log("Example accessor 0:", JSON.stringify(gltf.accessors[0]));
  }
  
  // Find a mesh primitive and its position accessor
  if (gltf.meshes && gltf.meshes.length > 0) {
    const firstMesh = gltf.meshes[0];
    console.log("First mesh:", firstMesh.name);
    const prim = firstMesh.primitives[0];
    if (prim && prim.attributes && prim.attributes.POSITION !== undefined) {
      const accessorIdx = prim.attributes.POSITION;
      const accessor = gltf.accessors[accessorIdx];
      console.log("Position accessor min/max for first mesh:", JSON.stringify(accessor));
    }
  }
}

inspectAccessors();
