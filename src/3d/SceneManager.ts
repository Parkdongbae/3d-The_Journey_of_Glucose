import {
  Clock,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  MathUtils,
  Mesh,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Sprite,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Material,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import type { CameraView, QualityLevel, ViewInsets } from "../types";
import { AoPass } from "./AoPass";
import type { ThemeName } from "./materials";
import { buildEnvironment, Studio, THEMES } from "./Studio";

export type Updater = (dt: number) => void;

const INITIAL_VIEW: CameraView = { position: { x: 0, y: 8.3, z: 23.5 }, target: { x: 0, y: 7.7, z: 0 } };
const BASE_FOV = 40;
const MAX_FOV = 78;
const FLY_DEFAULT_SEC = 1.4;
const FLY_THROUGH_DIST = 2.4;
const FLY_THROUGH_LIFT = 0.35;

interface Tween {
  fromPos: Vector3;
  toPos: Vector3;
  fromTarget: Vector3;
  toTarget: Vector3;
  t: number;
  dur: number;
  resolve: () => void;
}

/** 렌더러/카메라/조명/후처리/컨트롤/트윈/중앙 업데이트 루프. 모든 프레임 갱신은 update(dt)로 모인다. */
export class SceneManager {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly domElement: HTMLCanvasElement;

  private renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
  private controls: OrbitControls;
  private observer: ResizeObserver;
  private clock = new Clock();
  private updaters: Updater[] = [];
  private themeListeners: ((theme: ThemeName) => void)[] = [];
  private raf = 0;
  private disposed = false;
  private tween: Tween | null = null;
  private generation = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  private studio = new Studio();
  private key: DirectionalLight;
  private fill: DirectionalLight;
  private rim: DirectionalLight;
  private hemi: HemisphereLight;
  private theme: ThemeName = "light";

  private quality: QualityLevel = "auto";
  private effective: "high" | "low" = "high";
  private fpsAcc = 0;
  private fpsFrames = 0;
  private slowWindows = 0;

  private insets: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  private insetsNow: ViewInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  private width = 1;
  private height = 1;

  constructor(private container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.domElement = this.renderer.domElement;
    this.domElement.style.display = "block";
    this.domElement.style.touchAction = "none";
    container.appendChild(this.domElement);

    this.camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 400);
    this.camera.position.set(INITIAL_VIEW.position.x, INITIAL_VIEW.position.y, INITIAL_VIEW.position.z);

    this.controls = new OrbitControls(this.camera, this.domElement);
    this.controls.target.set(INITIAL_VIEW.target.x, INITIAL_VIEW.target.y, INITIAL_VIEW.target.z);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 34;
    this.controls.enablePan = true;
    this.controls.maxPolarAngle = Math.PI * 0.62;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.update();

    this.scene.environment = buildEnvironment(this.renderer);
    this.scene.add(this.studio.root);

    // 3점 조명: 키(그림자) + 필 + 림. 주변광은 낮게 두어 그림자 대비를 살린다.
    this.key = new DirectionalLight(0xfff1e0, 2.3);
    this.key.position.set(7, 19, 11);
    this.key.target.position.set(0, 7, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 10;
    sc.bottom = -10;
    sc.near = 2;
    sc.far = 44;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.key.shadow.radius = 5;
    this.fill = new DirectionalLight(0xbfd4ff, 0.5);
    this.fill.position.set(-10, 7, 6);
    this.rim = new DirectionalLight(0xdbeaff, 1.1);
    this.rim.position.set(-5, 12, -11);
    this.hemi = new HemisphereLight(0xffffff, 0x8791a6, 0.3);
    this.scene.add(this.key, this.key.target, this.fill, this.rim, this.hemi);

    // 사용자가 조작을 시작하면 카메라 이동을 즉시 멈춘다
    this.domElement.addEventListener("pointerdown", this.cancelTween, { capture: true });
    this.domElement.addEventListener("wheel", this.cancelTween, { capture: true, passive: true });

    this.setTheme("light");
    this.applyQuality();

    this.observer = new ResizeObserver(() => this.doResize());
    this.observer.observe(container);
    this.doResize();

    this.clock.start();
    this.loop();
  }

  registerUpdater(u: Updater): void {
    this.updaters.push(u);
  }

  onThemeChange(cb: (theme: ThemeName) => void): void {
    this.themeListeners.push(cb);
    cb(this.theme);
  }

  // ------------------------------------------------------------------- theme

  setTheme(theme: ThemeName): void {
    this.theme = theme;
    const spec = THEMES[theme];
    this.studio.applyTheme(spec);
    this.renderer.toneMappingExposure = spec.exposure;
    this.scene.environmentIntensity = spec.envIntensity;
    this.key.intensity = spec.key;
    this.fill.intensity = spec.fill;
    this.rim.intensity = spec.rim;
    this.hemi.intensity = spec.hemi;
    this.renderer.setClearColor(spec.skyMid, 1);
    for (const cb of this.themeListeners) cb(theme);
  }

  // ------------------------------------------------------------------ camera

  setAutoRotate(on: boolean): void {
    this.controls.autoRotate = on;
  }

  /** UI 패널이 가린 영역을 알려 주면 남은 영역의 한가운데에 피사체가 오도록 시점을 민다 */
  setViewInsets(insets: ViewInsets): void {
    this.insets = { ...insets };
  }

  flyTo(view: CameraView, durationSec = FLY_DEFAULT_SEC): Promise<void> {
    this.generation++;
    return this.rawFlyTo(
      new Vector3(view.position.x, view.position.y, view.position.z),
      new Vector3(view.target.x, view.target.y, view.target.z),
      Math.max(0.05, durationSec),
    );
  }

  resetView(durationSec = FLY_DEFAULT_SEC): Promise<void> {
    return this.flyTo(INITIAL_VIEW, durationSec);
  }

  /** 기관 근접 뷰 순회. 새 flyTo/flyThrough가 들어오면 취소되고 조기 resolve된다. */
  async flyThroughOrganIds(
    getOrganPosition: (id: string) => Vector3 | undefined,
    organIds: string[],
    perStopSec: number,
  ): Promise<void> {
    const gen = ++this.generation;
    const dwell = Math.max(0.2, perStopSec);
    for (const id of organIds) {
      const pos = getOrganPosition(id);
      if (!pos) continue;
      const dir = pos.clone().sub(new Vector3(0, pos.y, 0)); // 척추축에서의 수평 방향
      if (dir.lengthSq() < 0.02) dir.set(0.3, 0, 1);
      dir.z = Math.max(dir.z, Math.abs(dir.x) * 0.9 + 0.2); // 되도록 몸 앞쪽에서 본다
      dir.normalize();
      const camPos = pos
        .clone()
        .addScaledVector(dir, FLY_THROUGH_DIST)
        .add(new Vector3(0, FLY_THROUGH_LIFT, 0));
      const flyDur = MathUtils.clamp(dwell * 0.55, 0.6, 1.4);
      await this.rawFlyTo(camPos, pos, flyDur);
      if (this.disposed || gen !== this.generation) return;
      await this.delay(dwell * 1000);
      if (this.disposed || gen !== this.generation) return;
    }
  }

  private rawFlyTo(toPos: Vector3, toTarget: Vector3, dur: number): Promise<void> {
    const prev = this.tween;
    if (prev) prev.resolve();
    return new Promise<void>((resolve) => {
      this.tween = {
        fromPos: this.camera.position.clone(),
        toPos,
        fromTarget: this.controls.target.clone(),
        toTarget: toTarget.clone(),
        t: 0,
        dur,
        resolve,
      };
    });
  }

  private cancelTween = (): void => {
    const tween = this.tween;
    if (!tween) return;
    this.tween = null;
    this.controls.update();
    tween.resolve();
  };

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  // -------------------------------------------------------------------- loop

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.1);

    const tween = this.tween;
    if (tween) {
      tween.t += dt;
      const k = Math.min(tween.t / tween.dur, 1);
      const e = cubicInOut(k);
      this.camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
      this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
      this.camera.lookAt(this.controls.target);
      if (k >= 1) {
        this.tween = null;
        this.controls.update();
        tween.resolve();
      }
    } else {
      this.controls.update();
      this.clampTarget();
    }

    this.easeInsets(dt);
    for (const u of this.updaters) u(dt);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    this.watchFps(rawDt);
  };

  private clampTarget(): void {
    const t = this.controls.target;
    t.x = MathUtils.clamp(t.x, -3.5, 3.5);
    t.y = MathUtils.clamp(t.y, 0.2, 15.2);
    t.z = MathUtils.clamp(t.z, -3.5, 3.5);
  }

  // ----------------------------------------------------------------- quality

  setQuality(level: QualityLevel): void {
    this.quality = level;
    this.slowWindows = 0;
    this.applyQuality();
  }

  getEffectiveQuality(): "high" | "low" {
    return this.effective;
  }

  private applyQuality(): void {
    let eff: "high" | "low";
    if (this.quality === "auto") {
      const nav = navigator as Navigator & { deviceMemory?: number };
      const weak = (nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency ?? 8) <= 2;
      eff = weak ? "low" : "high";
    } else eff = this.quality;
    this.setEffective(eff);
  }

  private setEffective(eff: "high" | "low"): void {
    this.effective = eff;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(eff === "low" ? Math.min(dpr, 1) : Math.min(dpr, 1.75));
    this.renderer.shadowMap.enabled = eff === "high";
    this.key.castShadow = eff === "high";
    this.scene.traverse((o) => {
      if (o instanceof Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) (m as Material).needsUpdate = true;
      }
    });
    if (eff === "high" && !this.composer) {
      const size = this.renderer.getDrawingBufferSize(new Vector2());
      const target = new WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, target);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new AoPass(this.scene, this.camera, this.width, this.height));
      composer.addPass(new OutputPass());
      this.composer = composer;
    } else if (eff === "low" && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    // 렌더 타깃을 직접 넘기면 컴포저 픽셀비가 1로 고정되므로 렌더러와 맞춘다
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.doResize();
  }

  /** 자동 품질: 프레임이 계속 떨어지면 후처리·그림자를 끈다 (학교 노트북·태블릿 기준) */
  private watchFps(rawDt: number): void {
    if (this.quality !== "auto" || this.effective === "low" || document.hidden) return;
    if (rawDt > 0.5) return; // 탭 전환 등 일시 정지는 제외
    this.fpsAcc += rawDt;
    this.fpsFrames++;
    if (this.fpsAcc < 2) return;
    const fps = this.fpsFrames / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
    this.slowWindows = fps < 24 ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 3) this.setEffective("low");
  }

  // ------------------------------------------------------------------ sizing

  resize(): void {
    this.doResize();
  }

  private easeInsets(dt: number): void {
    const k = 1 - Math.exp(-dt * 7);
    let changed = false;
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const d = this.insets[side] - this.insetsNow[side];
      if (Math.abs(d) > 0.5) {
        this.insetsNow[side] += d * k;
        changed = true;
      } else if (d !== 0) {
        this.insetsNow[side] = this.insets[side];
        changed = true;
      }
    }
    if (changed) this.updateProjection();
  }

  private doResize(): void {
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(this.width, this.height, true);
    this.composer?.setSize(this.width, this.height);
    this.updateProjection();
  }

  /**
   * 패널을 뺀 '안전 영역'이 기준 화각으로 보이도록 전체 화각을 넓히고,
   * 주점(principal point)을 안전 영역 중심으로 옮긴다. 세로 화면에서는 가로가 잘리지 않게 더 넓힌다.
   */
  private updateProjection(): void {
    const W = this.width;
    const H = this.height;
    const i = this.insetsNow;
    const safeW = Math.max(W * 0.3, W - i.left - i.right);
    const safeH = Math.max(H * 0.3, H - i.top - i.bottom);
    const aspectFix = Math.max(1, 0.82 / (safeW / safeH));
    const halfSafe = Math.tan(MathUtils.degToRad(BASE_FOV / 2)) * aspectFix;
    const fov = MathUtils.radToDeg(2 * Math.atan(halfSafe * (H / safeH)));
    this.camera.fov = Math.min(MAX_FOV, fov);
    this.camera.aspect = W / H;
    const cx = i.left + safeW / 2;
    const cy = i.top + safeH / 2;
    const ox = W / 2 - cx;
    const oy = H / 2 - cy;
    if (Math.abs(ox) < 0.5 && Math.abs(oy) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(W, H, ox, oy, W, H);
    this.camera.updateProjectionMatrix();
  }

  /** 디버그·캡처용: 현재 카메라 시점 */
  getView(): CameraView {
    const p = this.camera.position;
    const t = this.controls.target;
    return { position: { x: p.x, y: p.y, z: p.z }, target: { x: t.x, y: t.y, z: t.z } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.tween) {
      this.tween.resolve();
      this.tween = null;
    }
    this.domElement.removeEventListener("pointerdown", this.cancelTween, { capture: true });
    this.domElement.removeEventListener("wheel", this.cancelTween, { capture: true });
    this.observer.disconnect();
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (obj instanceof Mesh || obj instanceof Sprite) {
        if (obj.geometry) obj.geometry.dispose();
        const mat = obj.material as Material | Material[] | undefined;
        if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m);
        else if (mat) disposeMaterial(mat);
      }
    });
    this.scene.environment?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.domElement.remove();
  }
}

function disposeMaterial(mat: Material): void {
  const anyMat = mat as Material & { map?: { dispose(): void } | null };
  anyMat.map?.dispose();
  mat.dispose();
}

function cubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
