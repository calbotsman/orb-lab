import * as THREE from "three";
import { makeGrain } from "./grain";

/** A fullscreen shader quad with a film-grain overlay, shared by the shader orbs. */
export function makeQuad<U extends Record<string, THREE.IUniform>>(el: HTMLElement, fragment: string, uniforms: U, grainOpacity = 0.05) {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  el.append(renderer.domElement);
  const grain = makeGrain(el, grainOpacity);
  const u: U & { uRes: THREE.IUniform<THREE.Vector2>; uTime: THREE.IUniform<number> } = { uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, ...uniforms };
  const mat = new THREE.ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: fragment,
    uniforms: u,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    u,
    render(dt: number, grainOp: number) {
      grain.frame(dt, grainOp);
      renderer.render(scene, camera);
    },
    resize(w: number, h: number) {
      renderer.setSize(w, h, false);
      u.uRes.value.set(w, h);
    },
    dispose() {
      mat.dispose();
      quad.geometry.dispose();
      renderer.dispose();
    },
  };
}

/** Shared GLSL: screen coords where the short side spans -1..1, y up. */
export const SCREEN_GLSL = /* glsl */ `
  uniform vec2 uRes;
  varying vec2 vUv;
  vec2 screenP(){ return (vUv - .5) * uRes / min(uRes.x, uRes.y) * 2.; }
`;
