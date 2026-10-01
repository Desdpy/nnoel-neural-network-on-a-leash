import * as THREE from "three";

type HologramMaterialOptions = {
  color: THREE.Color;
  opacity: number;
  wireframe?: boolean;
  depthTest?: boolean;
  blending?: THREE.Blending;
  /**
   * Which faces to shade. Defaults to ``DoubleSide`` because the
   * wireframe grids want their far-side wires drawn — that's what
   * makes the globe read as a sphere rather than a hemisphere.
   *
   * The solid shells pass ``FrontSide`` instead. Their back faces
   * land at ``0.2 * uOpacity`` (about 0.016 alpha at the shell's
   * 0.08), so they contribute a barely-visible interior fill —
   * while costing a *second* full pass of fragments over the same
   * pixels, on a scene that is fill-bound with ``depthWrite: false``
   * and therefore has no early-Z to reject them. FrontSide halves
   * the shell's fragment count, which is the second-largest surface
   * per ball after the halo.
   */
  side?: THREE.Side;
};

export function createHologramMaterial({
  color,
  opacity,
  wireframe = false,
  depthTest = true,
  blending = THREE.AdditiveBlending,
  side = THREE.DoubleSide,
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
    side,
    wireframe,
    blending,
  });
}
