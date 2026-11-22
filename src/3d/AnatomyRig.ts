import { Box3, Group, Mesh, type MeshStandardMaterial, Vector3 } from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import skeletonUrl from "../assets/skeleton.glb?url";
import organsUrl from "../assets/organs.glb?url";
import { ORGAN_MAP } from "../data/organs";
import type { BodyBuilder } from "./BodyBuilder";
import { bone, organTissue } from "./materials";

const TARGET_HEIGHT = 15.4;

const loadGltf = (loader: GLTFLoader, url: string): Promise<GLTF> =>
  new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

/**
 * Z-Anatomy 파생 골격 + 실제 기관(GLB)을 하나의 좌표계로 로드.
 * 골격 bbox로 정규변환(s, T)을 구해 기관에도 동일 적용 → 해부학적 정합 보장.
 * 기관은 BodyBuilder.adoptReal로 절차적 메시와 교체된다.
 */
export class AnatomyRig {
  readonly skeletonRoot = new Group();
  loaded = false;
  private skeletonDesired = false;
  private skeletonLoaded = false;

  constructor() {
    this.skeletonRoot.name = "skeleton";
    this.skeletonRoot.visible = false;
  }

  async load(body: BodyBuilder): Promise<number> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [skel, organs] = await Promise.all([loadGltf(loader, skeletonUrl), loadGltf(loader, organsUrl).catch(() => null)]);

    const s = this.normalizeSkeleton(skel.scene);
    this.applyBoneMaterial(skel.scene);
    this.skeletonRoot.add(skel.scene);
    this.skeletonRoot.updateMatrixWorld(true);
    freezeTransforms(this.skeletonRoot);
    this.skeletonLoaded = true;
    this.skeletonRoot.visible = this.skeletonDesired;

    let adopted = 0;
    if (organs !== null) {
      const organRoot = organs.scene;
      organRoot.scale.setScalar(s);
      organRoot.position.set(this.offset.x, this.offset.y, this.offset.z);
      organRoot.updateMatrixWorld(true);
      adopted = this.adoptOrgans(organRoot, body);
      freezeTransforms(organRoot);
    }
    this.loaded = true;
    return adopted;
  }

  setSkeletonVisible(on: boolean): void {
    this.skeletonDesired = on;
    if (this.skeletonLoaded) this.skeletonRoot.visible = on;
  }

  /** 골격 bbox 기준 정규화. 기관이 재사용할 s/오프셋을 반환한다. */
  private offset = new Vector3();

  private normalizeSkeleton(model: Group): number {
    const box = new Box3().setFromObject(model);
    if (box.isEmpty()) return 1;
    const size = box.getSize(new Vector3());
    const s = size.y > 0.0001 ? TARGET_HEIGHT / size.y : 1;
    model.scale.setScalar(s);
    box.setFromObject(model);
    const center = box.getCenter(new Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= box.min.y;
    this.offset.set(-center.x, -box.min.y, -center.z);
    return s;
  }

  private applyBoneMaterial(model: Group): void {
    const boneMat = bone();
    model.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = boneMat;
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.userData.isSkeleton = true; // 기관 레이캐스트 제외 마커
      }
    });
  }

  private adoptOrgans(root: Group, body: BodyBuilder): number {
    const byName = new Map<string, Mesh[]>();
    root.updateMatrixWorld(true);
    const rootMatrix = root.matrixWorld.clone();
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const id = organIdFromName(obj.name);
      if (id === null) return;
      // organRoot(스케일+오프셋) 변환을 메시에 베이크 — 재부모닝 후에도 정규화가 유지된다
      obj.applyMatrix4(rootMatrix);
      const list = byName.get(id) ?? [];
      list.push(obj);
      byName.set(id, list);
    });

    let adopted = 0;
    for (const [id, meshes] of byName) {
      const meta = ORGAN_MAP.get(id);
      if (meta === undefined) continue;
      const group = new Group();
      const materials: MeshStandardMaterial[] = [];
      for (const mesh of meshes) {
        mesh.removeFromParent();
        const mat = organTissue(id, meta.color);
        mesh.material = mat;
        materials.push(mat);
        group.add(mesh);
      }
      if (body.adoptReal(id, group, meshes, materials)) {
        adopted++;
        const center = new Box3().setFromObject(group).getCenter(new Vector3());
        const metaNow = ORGAN_MAP.get(id);
        if (metaNow !== undefined) metaNow.position = { x: center.x, y: center.y, z: center.z };
      }
      // 절차적 허파꽈리(실제 메시 없음)를 실제 폐 안쪽으로 재배치 — 허공에 뜨지 않도록
      const lungsRec = body.records.get("lungs");
      const alveoli = body.records.get("alveoli");
      if (lungsRec !== undefined && alveoli !== undefined) {
        const c = new Box3().setFromObject(lungsRec.group).getCenter(new Vector3());
        alveoli.group.position.set(c.x + 0.45, c.y - 0.5, c.z + 0.55);
      }
    }
    return adopted;
  }
}

function organIdFromName(name: string): string | null {
  if (!name.startsWith("ORG_")) return null;
  const id = name.slice(4).trim();
  return ORGAN_MAP.has(id) ? id : null;
}

function freezeTransforms(root: Group): void {
  root.traverse((obj) => {
    obj.matrixAutoUpdate = false;
    obj.matrixWorldAutoUpdate = false;
  });
}
