/**
 * 공용 재질 라이브러리 — 모든 3D 모델은 이 파일의 함수로만 재질을 만든다.
 * 함수는 호출마다 새 재질을 돌려준다(기관별 발광·투명도 애니메이션과 dispose가 안전).
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  ShaderMaterial,
} from "three";

import type { ThemeName } from "../types";

export type { ThemeName };

export interface OrganLook {
  color: number;
  roughness: number;
  clearcoat: number;
  sheen: number;
  opacity: number;
  doubleSided: boolean;
}

const BASE_LOOK: OrganLook = {
  color: 0xd98a8f,
  roughness: 0.46,
  clearcoat: 0.45,
  sheen: 0.35,
  opacity: 1,
  doubleSided: false,
};

/** 기관별 색·질감. 교과서 삽화에서 통용되는 색을 따르되 채도를 살려 서로 구분되게 한다. */
const ORGAN_LOOKS: Record<string, Partial<OrganLook>> = {
  mouth: { color: 0xc8424f, roughness: 0.3, clearcoat: 0.7 },
  esophagus: { color: 0xd9858c, roughness: 0.5 },
  stomach: { color: 0xe39a8c, roughness: 0.42, clearcoat: 0.55 },
  liver: { color: 0x8c3a2b, roughness: 0.36, clearcoat: 0.7, sheen: 0.2 },
  gallbladder: { color: 0x5a9a4c, roughness: 0.34, clearcoat: 0.7 },
  pancreas: { color: 0xe6c068, roughness: 0.55, clearcoat: 0.3 },
  smallIntestine: { color: 0xe8a48c, roughness: 0.44, clearcoat: 0.5 },
  largeIntestine: { color: 0xc47f6c, roughness: 0.5, clearcoat: 0.4 },
  nasal: { color: 0xdc9a86, roughness: 0.6, clearcoat: 0.15 },
  trachea: { color: 0xc9d4e6, roughness: 0.5, clearcoat: 0.35 },
  bronchi: { color: 0xb9c7dd, roughness: 0.5, clearcoat: 0.35 },
  lungs: { color: 0xe7959d, roughness: 0.58, clearcoat: 0.25, sheen: 0.6 },
  alveoli: { color: 0xf3b5ba, roughness: 0.4, clearcoat: 0.6 },
  diaphragm: { color: 0xc46f79, roughness: 0.55, clearcoat: 0.2, opacity: 0.8, doubleSided: true },
  heart: { color: 0xb42f3b, roughness: 0.36, clearcoat: 0.7 },
  aorta: { color: 0xd63a3a, roughness: 0.34, clearcoat: 0.7 },
  venaCava: { color: 0x3d6fd2, roughness: 0.34, clearcoat: 0.7 },
  kidneys: { color: 0x9b4a3b, roughness: 0.4, clearcoat: 0.6 },
  ureters: { color: 0xdcc9a2, roughness: 0.5 },
  bladder: { color: 0xe8d083, roughness: 0.42, clearcoat: 0.55 },
  thighCell: { color: 0xf6c445 },
};

export function organLook(id: string, fallbackColor: number): OrganLook {
  const over = ORGAN_LOOKS[id];
  return { ...BASE_LOOK, color: fallbackColor, ...over };
}

/** 젖은 생체 조직: 클리어코트(점막의 물기) + 시인(가장자리의 부드러운 산란) */
export function tissue(look: OrganLook): MeshPhysicalMaterial {
  const color = new Color(look.color);
  return new MeshPhysicalMaterial({
    color,
    roughness: look.roughness,
    metalness: 0,
    clearcoat: look.clearcoat,
    clearcoatRoughness: 0.32,
    sheen: look.sheen,
    sheenRoughness: 0.55,
    sheenColor: color.clone().lerp(new Color(0xffffff), 0.55),
    envMapIntensity: 1,
    side: look.doubleSided ? DoubleSide : FrontSide,
    transparent: look.opacity < 0.999,
    opacity: look.opacity,
    depthWrite: look.opacity > 0.6,
  });
}

export function organTissue(id: string, fallbackColor: number): MeshPhysicalMaterial {
  return tissue(organLook(id, fallbackColor));
}

/** 색만 지정하는 조직 재질(절차적 보조 부품용) */
export function tissueColor(color: number, over: Partial<OrganLook> = {}): MeshPhysicalMaterial {
  return tissue({ ...BASE_LOOK, color, ...over });
}

/** 뼈: 따뜻한 상아색, 광택 낮음 */
export function bone(): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: 0xe6dcc6, roughness: 0.62, metalness: 0, envMapIntensity: 0.9 });
}

/** 반투명 막(세포막·가로막 등) */
export function membrane(color: number, opacity: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness: 0.25,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.2,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** 스스로 빛나는 부품(세포핵·미토콘드리아 강조) */
export function glowing(color: number, emissive: number, intensity: number): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness: 0.35,
    metalness: 0,
    clearcoat: 0.5,
    clearcoatRoughness: 0.4,
    emissive,
    emissiveIntensity: intensity,
  });
}

/** 캐릭터(포도당·산소 등) 몸체: 사탕 같은 광택 */
export function candy(color: number, roughness = 0.3): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.15,
    emissive: color,
    emissiveIntensity: 0.18,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

/** 받침대 등 스튜디오 소품 */
export function studioPaint(color: number, roughness = 0.55): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness, metalness: 0.05 });
}

/** 윤곽선(역면 셸) */
export function outline(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, side: BackSide, toneMapped: false, transparent: true, opacity: 0.95 });
}

// --------------------------------------------------------------- 유리 피부

const SKIN_THEME: Record<ThemeName, { fill: number; rim: number; base: number; opacity: number; power: number }> = {
  light: { fill: 0xf2c9b0, rim: 0xb9785c, base: 0.07, opacity: 0.62, power: 2.4 },
  dark: { fill: 0x5f8fd6, rim: 0xa9dcff, base: 0.035, opacity: 0.7, power: 2.2 },
};

/**
 * 몸 실루엣용 프레넬 유리 재질 — 정면은 거의 투명해 속의 기관이 보이고,
 * 가장자리만 빛나 사람의 윤곽을 그린다.
 */
export function skinGlass(theme: ThemeName): ShaderMaterial {
  const mat = new ShaderMaterial({
    uniforms: {
      uFill: { value: new Color() },
      uRim: { value: new Color() },
      uBase: { value: 0 },
      uOpacity: { value: 1 },
      uPower: { value: 2 },
      uFade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFill;
      uniform vec3 uRim;
      uniform float uBase;
      uniform float uOpacity;
      uniform float uPower;
      uniform float uFade;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPower);
        float a = (uBase + f * (1.0 - uBase)) * uOpacity * uFade;
        gl_FragColor = vec4(mix(uFill, uRim, f), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  applySkinTheme(mat, theme);
  return mat;
}

export function applySkinTheme(mat: ShaderMaterial, theme: ThemeName): void {
  const t = SKIN_THEME[theme];
  const u = mat.uniforms;
  (u.uFill?.value as Color).set(t.fill);
  (u.uRim?.value as Color).set(t.rim);
  if (u.uBase) u.uBase.value = t.base;
  if (u.uOpacity) u.uOpacity.value = t.opacity;
  if (u.uPower) u.uPower.value = t.power;
  mat.blending = theme === "dark" ? AdditiveBlending : NormalBlending;
}

/** 깊이만 쓰는 재질 — 유리 피부의 안쪽 겹침선을 가린다 */
export function depthOnly(): MeshBasicMaterial {
  return new MeshBasicMaterial({ colorWrite: false, depthWrite: true });
}

/** 경로 안내선: 진행 방향으로 흐르는 점선 발광 튜브 */
export function flowLine(color: Color): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uTime: { value: 0 },
      uHead: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uHead;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float dash = smoothstep(0.35, 0.5, fract(vUv.x * 26.0 - uTime * 1.6));
        float passed = 1.0 - smoothstep(uHead - 0.02, uHead + 0.02, vUv.x);
        float a = mix(0.16, 0.85, passed) * mix(0.55, 1.0, dash) * uOpacity;
        gl_FragColor = vec4(uColor * mix(0.9, 1.5, passed), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
}
