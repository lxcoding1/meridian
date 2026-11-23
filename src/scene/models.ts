import * as THREE from 'three';
import { ExchangeId, StockDefinition } from '../simulation/types';
import { SceneMaterialLibrary } from './materials';
import { createExchangePlaqueTexture } from './textures';

export interface ExchangePavilionParts {
  group: THREE.Group;
  exchangeId: ExchangeId;
  spireCore: THREE.Mesh;
  spireCoreMat: THREE.MeshStandardMaterial;
  spireCrown: THREE.Mesh;
  ringMesh: THREE.Mesh;
  ringMat: THREE.MeshStandardMaterial;
  ribbonMesh: THREE.Mesh;
  ribbonMat: THREE.MeshStandardMaterial;
  hitProxy: THREE.Mesh;
  dispose: () => void;
}

export interface StockMonolithParts {
  group: THREE.Group;
  symbol: string;
  exchange: ExchangeId;
  baseColor: THREE.Color;
  coreMesh: THREE.Mesh;
  coreMat: THREE.MeshStandardMaterial;
  crownMesh: THREE.Mesh;
  crownMat: THREE.MeshStandardMaterial;
  collarMesh: THREE.Mesh;
  hitProxy: THREE.Mesh;
  homePos: THREE.Vector3;
  targetPos: THREE.Vector3;
  currentScaleY: number;
  targetScaleY: number;
  dispose: () => void;
}

function createOctagonalPlinthGeometry(radius: number, height: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const sides = 8;
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.08,
    bevelSegments: 2,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function createExchangePavilionGroup(
  exchangeId: ExchangeId,
  accentHex: string,
  subtitle: string,
  worldX: number,
  worldZ: number,
  mats: SceneMaterialLibrary,
  maxAnisotropy: number,
): ExchangePavilionParts {
  const group = new THREE.Group();
  group.position.set(worldX, 0, worldZ);

  const disposables: { dispose: () => void }[] = [];
  const accentColor = new THREE.Color(accentHex);

  // 1. Soft radial contact shadow grounded at y = 0.015
  const shadowGeo = new THREE.CircleGeometry(5.6, 32);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowDisc = new THREE.Mesh(shadowGeo, mats.contactShadow);
  shadowDisc.position.y = 0.015;
  group.add(shadowDisc);
  disposables.push(shadowGeo);

  // 2. Stepped lower octagonal plinth (sits flush at y = 0.08 bevel base)
  const lowerPlinthGeo = createOctagonalPlinthGeometry(4.4, 0.24);
  const lowerPlinth = new THREE.Mesh(lowerPlinthGeo, mats.anodizedBase);
  lowerPlinth.position.y = 0.08;
  lowerPlinth.receiveShadow = true;
  lowerPlinth.castShadow = true;
  group.add(lowerPlinth);
  disposables.push(lowerPlinthGeo);

  // 3. Upper brushed titanium terrace step (offset cleanly on Y)
  const upperPlinthGeo = createOctagonalPlinthGeometry(2.6, 0.26);
  const upperPlinth = new THREE.Mesh(upperPlinthGeo, mats.brushedTitanium);
  upperPlinth.position.y = 0.36;
  upperPlinth.receiveShadow = true;
  upperPlinth.castShadow = true;
  group.add(upperPlinth);
  disposables.push(upperPlinthGeo);

  // 4. Illuminated telemetry ring on plinth deck (polygonOffset to prevent Z-fight)
  const ringGeo = new THREE.RingGeometry(2.85, 3.05, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.85,
    roughness: 0.3,
    metalness: 0.2,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.y = 0.405;
  group.add(ringMesh);
  disposables.push(ringGeo, ringMat);

  // 5. Central pylon base collar
  const collarGeo = new THREE.CylinderGeometry(0.85, 1.05, 0.45, 8);
  const collar = new THREE.Mesh(collarGeo, mats.anodizedBase);
  collar.position.y = 0.9;
  collar.castShadow = true;
  group.add(collar);
  disposables.push(collarGeo);

  // 6. Central dynamic index spire core (pivot at bottom)
  const spireCoreGeo = new THREE.CylinderGeometry(0.46, 0.56, 1, 8);
  spireCoreGeo.translate(0, 0.5, 0);
  const spireCoreMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.45,
    roughness: 0.28,
    metalness: 0.55,
  });
  const spireCore = new THREE.Mesh(spireCoreGeo, spireCoreMat);
  spireCore.position.y = 1.12;
  spireCore.scale.y = 3.2;
  spireCore.castShadow = true;
  group.add(spireCore);
  disposables.push(spireCoreGeo, spireCoreMat);

  // 7. Outer optical glass housing sleeve around spire
  const glassSleeveGeo = new THREE.CylinderGeometry(0.72, 0.78, 4.8, 8);
  const glassSleeve = new THREE.Mesh(glassSleeveGeo, mats.glassSheath);
  glassSleeve.position.y = 3.52;
  glassSleeve.renderOrder = 2;
  group.add(glassSleeve);
  disposables.push(glassSleeveGeo);

  // 8. Spire crown beacon
  const crownGeo = new THREE.ConeGeometry(0.58, 0.75, 8);
  const spireCrown = new THREE.Mesh(crownGeo, mats.brushedTitanium);
  spireCrown.position.y = 4.5;
  spireCrown.castShadow = true;
  group.add(spireCrown);
  disposables.push(crownGeo);

  // 9. Front architectural exchange plaque (ahead of the 5-stock arc)
  const plaqueBaseGeo = new THREE.BoxGeometry(2.75, 0.22, 0.9);
  const plaqueBase = new THREE.Mesh(plaqueBaseGeo, mats.anodizedBase);
  plaqueBase.position.set(0, 0.11, 6.5);
  plaqueBase.castShadow = true;
  plaqueBase.receiveShadow = true;
  group.add(plaqueBase);
  disposables.push(plaqueBaseGeo);

  const plaqueTex = createExchangePlaqueTexture(exchangeId, accentHex, subtitle, maxAnisotropy);
  const plaqueGeo = new THREE.PlaneGeometry(2.6, 0.96);
  const plaqueMat = new THREE.MeshStandardMaterial({
    map: plaqueTex,
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.45,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const plaque = new THREE.Mesh(plaqueGeo, plaqueMat);
  plaque.position.set(0, 0.44, 6.5);
  plaque.rotation.x = -Math.PI / 4.2;
  group.add(plaque);
  disposables.push(plaqueTex, plaqueGeo, plaqueMat);

  // 10. 3D Trajectory Ribbon behind the pavilion
  const initPoints = [
    new THREE.Vector3(-3.2, 1.8, -2.5),
    new THREE.Vector3(-1.0, 2.1, -2.9),
    new THREE.Vector3(1.0, 2.0, -2.9),
    new THREE.Vector3(3.2, 2.3, -2.5),
  ];
  const initCurve = new THREE.CatmullRomCurve3(initPoints);
  const ribbonGeo = new THREE.TubeGeometry(initCurve, 40, 0.085, 8, false);
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.6,
    roughness: 0.25,
    metalness: 0.5,
  });
  const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
  group.add(ribbonMesh);
  disposables.push(ribbonMat);

  // 11. Simplified invisible raycast proxy on layer 1
  const proxyGeo = new THREE.CylinderGeometry(4.3, 4.5, 5.5, 8);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxy = new THREE.Mesh(proxyGeo, proxyMat);
  hitProxy.position.y = 2.75;
  hitProxy.layers.set(1);
  hitProxy.userData = { kind: 'exchange', exchangeId };
  group.add(hitProxy);
  disposables.push(proxyGeo, proxyMat);

  return {
    group,
    exchangeId,
    spireCore,
    spireCoreMat,
    spireCrown,
    ringMesh,
    ringMat,
    ribbonMesh,
    ribbonMat,
    hitProxy,
    dispose: () => {
      ribbonMesh.geometry.dispose();
      disposables.forEach((d) => d.dispose());
    },
  };
}

export function updatePavilionRibbonGeometry(
  pavilion: ExchangePavilionParts,
  history: number[],
  baseIndex: number,
) {
  if (history.length < 4) return;
  const pts: THREE.Vector3[] = [];
  const sampleCount = 24;
  const step = (history.length - 1) / (sampleCount - 1);

  for (let i = 0; i < sampleCount; i++) {
    const idx = Math.min(history.length - 1, Math.round(i * step));
    const t = i / (sampleCount - 1);
    const pctDelta = ((history[idx] - baseIndex) / baseIndex) * 100;
    const angle = (t - 0.5) * Math.PI * 0.92;
    const radius = 3.55;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius * 0.85 - 0.3;
    const y = THREE.MathUtils.clamp(2.2 + pctDelta * 0.42, 0.85, 4.75);
    pts.push(new THREE.Vector3(x, y, z));
  }

  const curve = new THREE.CatmullRomCurve3(pts);
  const nextGeo = new THREE.TubeGeometry(curve, 36, 0.085, 8, false);
  pavilion.ribbonMesh.geometry.dispose();
  pavilion.ribbonMesh.geometry = nextGeo;
}

export function createStockMonolithGroup(
  def: StockDefinition,
  homePos: THREE.Vector3,
  mats: SceneMaterialLibrary,
): StockMonolithParts {
  const group = new THREE.Group();
  group.position.copy(homePos);

  const disposables: { dispose: () => void }[] = [];
  const baseColor = new THREE.Color(def.color);

  // 1. Contact shadow disc
  const shadowGeo = new THREE.CircleGeometry(0.95, 24);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowDisc = new THREE.Mesh(shadowGeo, mats.contactShadow);
  shadowDisc.position.y = 0.015;
  group.add(shadowDisc);
  disposables.push(shadowGeo);

  // 2. Hexagonal anodized pedestal socket (bottom-center pivot)
  const baseGeo = new THREE.CylinderGeometry(0.62, 0.74, 0.28, 6);
  const baseMesh = new THREE.Mesh(baseGeo, mats.anodizedBase);
  baseMesh.position.y = 0.14;
  baseMesh.castShadow = true;
  baseMesh.receiveShadow = true;
  group.add(baseMesh);
  disposables.push(baseGeo);

  // 3. Brushed titanium collar ring
  const collarGeo = new THREE.TorusGeometry(0.56, 0.055, 8, 24);
  collarGeo.rotateX(Math.PI / 2);
  const collarMesh = new THREE.Mesh(collarGeo, mats.brushedTitanium);
  collarMesh.position.y = 0.3;
  group.add(collarMesh);
  disposables.push(collarGeo);

  // 4. Translucent outer glass housing cylinder
  const glassGeo = new THREE.CylinderGeometry(0.48, 0.5, 3.8, 6);
  const glassMesh = new THREE.Mesh(glassGeo, mats.glassSheath);
  glassMesh.position.y = 2.22;
  glassMesh.renderOrder = 2;
  group.add(glassMesh);
  disposables.push(glassGeo);

  // 5. Inner dynamic performance core (pivot at bottom y = 0.32)
  const coreGeo = new THREE.CylinderGeometry(0.32, 0.35, 1, 6);
  coreGeo.translate(0, 0.5, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor,
    emissiveIntensity: 0.38,
    roughness: 0.26,
    metalness: 0.58,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.y = 0.32;
  coreMesh.scale.y = 1.6;
  coreMesh.castShadow = true;
  group.add(coreMesh);
  disposables.push(coreGeo, coreMat);

  // 6. Crown cap atop core bar
  const crownGeo = new THREE.CylinderGeometry(0.2, 0.36, 0.24, 6);
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: baseColor,
    emissiveIntensity: 0.25,
    roughness: 0.18,
    metalness: 0.9,
  });
  const crownMesh = new THREE.Mesh(crownGeo, crownMat);
  crownMesh.position.y = 0.32 + 1.6 + 0.12;
  group.add(crownMesh);
  disposables.push(crownGeo, crownMat);

  // 7. Raycast hit proxy on layer 1
  const proxyGeo = new THREE.CylinderGeometry(0.75, 0.8, 4.4, 6);
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  const hitProxy = new THREE.Mesh(proxyGeo, proxyMat);
  hitProxy.position.y = 2.2;
  hitProxy.layers.set(1);
  hitProxy.userData = { kind: 'stock', symbol: def.symbol };
  group.add(hitProxy);
  disposables.push(proxyGeo, proxyMat);

  return {
    group,
    symbol: def.symbol,
    exchange: def.exchange,
    baseColor,
    coreMesh,
    coreMat,
    crownMesh,
    crownMat,
    collarMesh,
    hitProxy,
    homePos: homePos.clone(),
    targetPos: homePos.clone(),
    currentScaleY: 1.6,
    targetScaleY: 1.6,
    dispose: () => {
      disposables.forEach((d) => d.dispose());
    },
  };
}
