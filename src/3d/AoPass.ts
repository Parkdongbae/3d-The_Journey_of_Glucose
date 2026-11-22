import { type Object3D, type Material, type Scene, type Camera } from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

interface Internals {
  _visibilityCache: Object3D[];
  scene: Scene;
}

/**
 * GTAO 법선·깊이 패스에서 반투명체·스프라이트·선·보조 표식을 숨긴다.
 * (안 숨기면 유리 피부가 불투명한 그늘을 만들고 라벨 자리가 탄다)
 */
export class AoPass extends GTAOPass {
  constructor(scene: Scene, camera: Camera, width: number, height: number) {
    super(scene, camera, width, height);
    this.blendIntensity = 0.9;
    this.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.2, thickness: 1.2, scale: 1.15, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
  }

  // 부모의 비공개 훅을 덮어쓴다 (three r180 기준 이름)
  _overrideVisibility(): void {
    const self = this as unknown as Internals;
    const cache = self._visibilityCache;
    self.scene.traverse((object) => {
      if (!object.visible) return;
      const o = object as Object3D & { isPoints?: boolean; isLine?: boolean; isSprite?: boolean; isMesh?: boolean; material?: Material | Material[] };
      let hide = o.isPoints === true || o.isLine === true || o.isSprite === true || o.userData.noAO === true;
      if (!hide && o.isMesh === true && o.material !== undefined) {
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        if (mat !== undefined && (mat.transparent || !mat.depthWrite || !mat.colorWrite)) hide = true;
      }
      if (hide) {
        object.visible = false;
        cache.push(object);
      }
    });
  }
}
