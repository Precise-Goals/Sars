import { readFileSync } from "fs";
import { join } from "path";

const glbPath = "d:/Workspace/Projects/Sars/assets/industry.glb";

function inspectGlb() {
  const buffer = readFileSync(glbPath);
  
  // Read GLB Header
  const magic = buffer.toString("utf8", 0, 4);
  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);
  
  console.log(`GLB Magic: ${magic}`);
  console.log(`GLB Version: ${version}`);
  console.log(`GLB Total Length: ${totalLength} bytes`);
  
  if (magic !== "glTF") {
    console.error("Invalid GLB file");
    return;
  }
  
  // Read Chunk 0 (JSON)
  const chunk0Length = buffer.readUInt32LE(12);
  const chunk0Type = buffer.toString("utf8", 16, 20);
  
  console.log(`Chunk 0 Length: ${chunk0Length} bytes`);
  console.log(`Chunk 0 Type: ${chunk0Type}`);
  
  if (chunk0Type !== "JSON") {
    console.error("Chunk 0 is not JSON");
    return;
  }
  
  const jsonStr = buffer.toString("utf8", 20, 20 + chunk0Length);
  const gltf = JSON.parse(jsonStr);
  
  console.log("\nNodes in GLTF:");
  if (gltf.nodes) {
    gltf.nodes.forEach((node: any, idx: number) => {
      console.log(`Node ${idx}: Name = "${node.name || ""}", Mesh = ${node.mesh !== undefined ? node.mesh : "none"}, Translation = ${JSON.stringify(node.translation)}, Scale = ${JSON.stringify(node.scale)}, Rotation = ${JSON.stringify(node.rotation)}`);
    });
  }
  
  console.log("\nMeshes in GLTF:");
  if (gltf.meshes) {
    gltf.meshes.forEach((mesh: any, idx: number) => {
      console.log(`Mesh ${idx}: Name = "${mesh.name || ""}", Primitives count = ${mesh.primitives ? mesh.primitives.length : 0}`);
    });
  }
  
  console.log("\nScenes in GLTF:");
  console.log(JSON.stringify(gltf.scenes, null, 2));
}

inspectGlb();
