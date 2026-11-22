/**
 * 스튜디오: 환경맵(직접 만든 소프트박스 씬) · 배경 돔 · 받침대.
 * 테마(밝음/다크)에 따라 색·세기를 한 표로 묶어 한 번에 바꾼다.
 */
import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  CircleGeometry,
  Color,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  PMREMGenerator,
  RingGeometry,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  Vector2,
  type Texture,
  type WebGLRenderer,
} from "three";
import { studioPaint, type ThemeName } from "./materials";

export interface ThemeSpec {
  skyTop: number;
  skyMid: number;
  skyBottom: number;
  pedestal: number;
  ring: number;
  shadowOpacity: number;
  exposure: number;
  envIntensity: number;
  key: number;
  fill: number;
  rim: number;
  hemi: number;
}

export const THEMES: Record<ThemeName, ThemeSpec> = {
  light: {
    skyTop: 0xdfe9f7,
    skyMid: 0xf3f6fb,
    skyBottom: 0xc9d6ea,
    pedestal: 0xf4f6fa,
    ring: 0x5b8def,
    shadowOpacity: 0.26,
    exposure: 1.0,
    envIntensity: 0.75,
    key: 2.3,
    fill: 0.5,
    rim: 1.1,
    hemi: 0.3,
  },
  dark: {
    skyTop: 0x070b16,
    skyMid: 0x131c33,
    skyBottom: 0x05070d,
    pedestal: 0x1a2236,
    ring: 0x6aa8ff,
    shadowOpacity: 0.5,
    exposure: 1.05,
    envIntensity: 0.6,
    key: 2.5,
    fill: 0.35,
    rim: 1.6,
    hemi: 0.14,
  },
};

/** 소프트박스 + 스트립 라이트로 구성한 환경맵. 젖은 조직 표면에 길쭉한 하이라이트를 만든다. */
export function buildEnvironment(renderer: WebGLRenderer): Texture {
  const env = new Scene();
  const room = new Mesh(
    new SphereGeometry(30, 32, 16),
    new MeshBasicMaterial({ color: 0x8793a8, side: BackSide }),
  );
  env.add(room);
  const panel = (w: number, h: number, intensity: number, x: number, y: number, z: number, tint = 0xffffff): void => {
    const mat = new MeshBasicMaterial({ color: new Color(tint).multiplyScalar(intensity) });
    const m = new Mesh(new BoxGeometry(w, h, 0.2), mat);
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(16, 12, 5.5, 8, 16, 14, 0xfff4e6); // 키 소프트박스(따뜻함)
  panel(14, 16, 2.2, -18, 4, 6, 0xdde8ff); // 필(차가움)
  panel(2, 22, 9, 16, 2, -10); // 스트립 — 윤곽 하이라이트
  panel(2, 22, 7, -14, 3, -14, 0xcfe2ff);
  panel(24, 2, 4, 0, 20, -4);
  panel(30, 30, 0.9, 0, -18, 0, 0xcfd6e2); // 바닥 반사광
  const pmrem = new PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  env.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as MeshBasicMaterial).dispose();
    }
  });
  return tex;
}

export class Studio {
  readonly root = new Group();
  private dome: Mesh;
  private pedestalMat = studioPaint(0xffffff, 0.5);
  private ringMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 });
  private shadowMat = new ShadowMaterial({ opacity: 0.25 });
  private pedestal: Mesh;
  private shadowCatcher: Mesh;

  constructor() {
    this.root.name = "studio";

    // 배경 돔: 세로 그라데이션(버텍스 컬러)
    const domeGeo = new SphereGeometry(90, 48, 32);
    domeGeo.setAttribute("color", new BufferAttribute(new Float32Array(domeGeo.attributes.position!.count * 3), 3));
    this.dome = new Mesh(domeGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }));
    this.dome.position.y = 8;
    this.dome.renderOrder = -10;
    this.dome.userData.noAO = true;
    this.root.add(this.dome);

    // 받침대: 모따기 넣은 회전체
    const R = 3.3;
    const H = 0.22;
    const profile = [
      new Vector2(0, 0),
      new Vector2(R - 0.05, 0),
      new Vector2(R, -0.05),
      new Vector2(R, -H + 0.05),
      new Vector2(R - 0.05, -H),
      new Vector2(0, -H),
    ];
    this.pedestal = new Mesh(new LatheGeometry(profile, 96), this.pedestalMat);
    this.pedestal.receiveShadow = true;
    this.root.add(this.pedestal);

    const ring = new Mesh(new RingGeometry(R - 0.34, R - 0.28, 96), this.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    ring.userData.noAO = true;
    this.root.add(ring);

    // 받침대 밖 바닥 그림자
    this.shadowCatcher = new Mesh(new CircleGeometry(14, 48), this.shadowMat);
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = -H;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.userData.noAO = true;
    this.root.add(this.shadowCatcher);
  }

  applyTheme(spec: ThemeSpec): void {
    const geo = this.dome.geometry;
    const pos = geo.attributes.position!;
    const col = geo.attributes.color as BufferAttribute;
    const top = new Color(spec.skyTop);
    const mid = new Color(spec.skyMid);
    const bottom = new Color(spec.skyBottom);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 90; // -1..1
      if (t >= 0) c.copy(mid).lerp(top, Math.min(1, t * 1.6));
      else c.copy(mid).lerp(bottom, Math.min(1, -t * 2.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
    this.pedestalMat.color.set(spec.pedestal);
    this.ringMat.color.set(spec.ring);
    this.shadowMat.opacity = spec.shadowOpacity;
  }
}
