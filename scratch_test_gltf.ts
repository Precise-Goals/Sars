import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readFileSync } from 'fs';

// To use GLTFLoader in Node/Bun, we often have to parse from an ArrayBuffer directly
const glbPath = "d:/Workspace/Projects/Sars/assets/industry.glb";

async function run() {
  const buffer = readFileSync(glbPath);
  
  // We can convert the buffer to an ArrayBuffer
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  const loader = new GLTFLoader();
  
  try {
    loader.parse(arrayBuffer, '', (gltf) => {
      console.log("Successfully parsed GLTF with Three.js!");
      console.log("Scene children:", gltf.scene.children.length);
      let meshCount = 0;
      gltf.scene.traverse(c => {
        if ((c as THREE.Mesh).isMesh) meshCount++;
      });
      console.log("Total meshes:", meshCount);
    }, (err) => {
      console.error("Parse error callback:", err);
    });
  } catch (err) {
    console.error("Exception during parsing:", err);
  }
}

run();
