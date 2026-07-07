import RAPIER from '@dimforge/rapier3d-compat';

async function run() {
  await RAPIER.init();
  console.log("Rapier loaded successfully.");
  const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

  // Create a dynamic body
  let bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(0.0, 1.0, 0.0);
  let body = world.createRigidBody(bodyDesc);

  // Create a cuboid collider attached to the dynamic rigidBody
  let colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5);
  let collider = world.createCollider(colliderDesc, body);

  // Step the simulation
  world.step();

  console.log("World stepped successfully. Body translation Y:", body.translation().y);
}

run().catch(console.error);
