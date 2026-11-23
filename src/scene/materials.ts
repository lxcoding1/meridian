import * as THREE from 'three';

export interface SceneMaterialLibrary {
  floor: THREE.MeshStandardMaterial;
  anodizedBase: THREE.MeshStandardMaterial;
  brushedTitanium: THREE.MeshPhysicalMaterial;
  glassSheath: THREE.MeshPhysicalMaterial;
  zeroDatumPlane: THREE.MeshPhysicalMaterial;
  contactShadow: THREE.MeshBasicMaterial;
  dispose: () => void;
}

export function createSceneMaterialLibrary(
  isSoftwareGl: boolean,
  floorGridTex: THREE.CanvasTexture,
  brushedBumpTex: THREE.CanvasTexture,
  shadowTex: THREE.CanvasTexture,
): SceneMaterialLibrary {
  const floor = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: floorGridTex,
    roughness: 0.78,
    metalness: 0.16,
  });

  const anodizedBase = new THREE.MeshStandardMaterial({
    color: 0x162032,
    roughness: 0.48,
    metalness: 0.76,
    bumpMap: brushedBumpTex,
    bumpScale: 0.015,
  });

  const brushedTitanium = new THREE.MeshPhysicalMaterial({
    color: 0x94a3b8,
    roughness: 0.22,
    metalness: 0.92,
    anisotropy: 0.8,
    bumpMap: brushedBumpTex,
    bumpScale: 0.008,
  });

  const glassSheath = new THREE.MeshPhysicalMaterial({
    color: 0xdbeafe,
    metalness: 0.05,
    roughness: 0.08,
    transmission: isSoftwareGl ? 0 : 0.85,
    transparent: true,
    opacity: isSoftwareGl ? 0.24 : 0.92,
    ior: 1.52,
    thickness: 0.6,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    depthWrite: false,
  });

  const zeroDatumPlane = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    metalness: 0.1,
    roughness: 0.25,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const contactShadow = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });

  return {
    floor,
    anodizedBase,
    brushedTitanium,
    glassSheath,
    zeroDatumPlane,
    contactShadow,
    dispose: () => {
      floor.dispose();
      anodizedBase.dispose();
      brushedTitanium.dispose();
      glassSheath.dispose();
      zeroDatumPlane.dispose();
      contactShadow.dispose();
    },
  };
}
