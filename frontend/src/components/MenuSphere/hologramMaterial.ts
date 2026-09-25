import * as THREE from "three";

type HologramMaterialOptions = {
  color: THREE.Color;
  opacity: number;
  wireframe?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
};

export function createHologramMaterial({
  color,
  opacity,
  wireframe = false,
  depthTest = true,
  blending = THREE.AdditiveBlending,
}: HologramMaterialOptions): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: opacity },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        float facing = dot(normalize(vNormal), normalize(vViewDirection));
        float frontFade = smoothstep(-0.2, 0.65, facing);
        float backFade = mix(0.2, 1.0, frontFade);
        gl_FragColor = vec4(uColor, uOpacity * backFade);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest,
    side: THREE.DoubleSide,
    wireframe,
    blending,
  });
}
