import * as THREE from "three";
import { createHologramMaterial } from "./hologramMaterial";

export type FaceLight = {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  phase: number;
  speed: number;
};

export function createFaceLights(
  sourceGeometry: THREE.BufferGeometry,
  color: THREE.Color,
  count: number
): { group: THREE.Group; lights: FaceLight[] } {
  const group = new THREE.Group();
  const lights: FaceLight[] = [];
  const index = sourceGeometry.getIndex();
  const position = sourceGeometry.getAttribute("position");
  if (!index || !position) return { group, lights };

  const faceCount = Math.floor(index.count / 3);
  const targetCount = Math.min(count, faceCount);
  const selectedFaces = new Set<number>();
  while (selectedFaces.size < targetCount) {
    selectedFaces.add(Math.floor(Math.random() * faceCount));
  }

  const vertex = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const faceIndex = i / 3;
    if (!selectedFaces.has(faceIndex)) continue;

    const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map(
      (vertexIndex) => {
        vertex.fromBufferAttribute(position, vertexIndex);
        return vertex.clone();
      }
    );
    const center = vertices
      .reduce((sum, current) => sum.add(current), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length);
    const normal = center.clone().normalize();
    const faceGeometry = new THREE.BufferGeometry();
    const facePositions = new Float32Array(9);
    vertices.forEach((current, vertexIndex) => {
      const relative = current.sub(center);
      facePositions[vertexIndex * 3] = relative.x;
      facePositions[vertexIndex * 3 + 1] = relative.y;
      facePositions[vertexIndex * 3 + 2] = relative.z;
    });
    faceGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(facePositions, 3)
    );
    faceGeometry.computeVertexNormals();
    faceGeometry.computeBoundingSphere();

    const material = createHologramMaterial({
      color,
      opacity: 0,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(faceGeometry, material);
    mesh.position.copy(center).addScaledVector(normal, 0.003);
    mesh.renderOrder = 2;
    group.add(mesh);
    lights.push({
      mesh,
      material,
      phase: Math.random() * Math.PI * 2,
      speed: 0.35 + Math.random() * 0.7,
    });
  }

  return { group, lights };
}

export function updateFaceLights(
  lights: FaceLight[],
  time: number,
  intensity: number
): void {
  for (const light of lights) {
    const wave = Math.sin(time * light.speed + light.phase);
    const lit = Math.pow(Math.max(0, wave), 10);
    light.material.uniforms.uOpacity.value = lit * intensity * 0.45;
    light.mesh.scale.setScalar(0.85 + lit * 0.35);
  }
}
