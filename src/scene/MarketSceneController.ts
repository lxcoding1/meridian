import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  collectHeatSources,
  computeHeatScaleMax,
  generateHeatmapFieldData,
  HeatmapMode,
} from '../simulation/heatmap';
import { EXCHANGE_METADATA, STOCK_CATALOG } from '../simulation/marketData';
import { computeComparisonSeries } from '../simulation/marketEngine';
import { collectMomentumEmitters } from '../simulation/momentumParticles';
import {
  CameraPreset,
  ComparisonMetricMode,
  ExchangeId,
  MarketSimulationState,
  ViewMode,
} from '../simulation/types';
import { createSceneMaterialLibrary, SceneMaterialLibrary } from './materials';
import {
  createExchangePavilionGroup,
  createStockMonolithGroup,
  ExchangePavilionParts,
  StockMonolithParts,
  updatePavilionRibbonGeometry,
} from './models';
import { ActiveWorldEmitter, MomentumParticleSystem } from './MomentumParticleSystem';
import {
  createBrushedMetalBumpTexture,
  createFloorGridTexture,
  createRadialShadowTexture,
} from './textures';

export interface ProjectedLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

export interface SceneControllerCallbacks {
  onSelectExchange: (exchangeId: ExchangeId) => void;
  onSelectStock: (symbol: string) => void;
  onHoverItem: (item: { kind: 'exchange' | 'stock'; id: string } | null) => void;
  onLabelsFrame: (labels: Record<string, ProjectedLabel>) => void;
  onMomentumChange?: (symbols: string[]) => void;
}

interface CameraPose {
  pos: THREE.Vector3;
  target: THREE.Vector3;
}

const CAMERA_POSES: Record<CameraPreset, CameraPose> = {
  panoramic: {
    pos: new THREE.Vector3(0, 17.5, 34.5),
    target: new THREE.Vector3(0, 1.8, 0.8),
  },
  TSX: {
    pos: new THREE.Vector3(-13.5, 9.2, 16.5),
    target: new THREE.Vector3(-12.2, 2.0, 2.5),
  },
  NASDAQ: {
    pos: new THREE.Vector3(0, 9.5, 12.2),
    target: new THREE.Vector3(0, 2.2, -2.0),
  },
  NYSE: {
    pos: new THREE.Vector3(13.5, 9.2, 16.5),
    target: new THREE.Vector3(12.2, 2.0, 2.5),
  },
  compare_front: {
    pos: new THREE.Vector3(0, 7.6, 18.2),
    target: new THREE.Vector3(0, 2.0, 1.4),
  },
  compare_iso: {
    pos: new THREE.Vector3(12.0, 10.2, 16.5),
    target: new THREE.Vector3(0, 2.0, 1.4),
  },
};

// Pre-allocated scratch math helpers (Zero GC inside render loop)
const _vec3 = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _colorTarget = new THREE.Color();
const _gainColor = new THREE.Color('#10b981');
const _lossColor = new THREE.Color('#f43f5e');
const _neutralColor = new THREE.Color('#94a3b8');

const HEATMAP_COLS = 64;
const HEATMAP_ROWS = 36;
const HEATMAP_WORLD_W = 46;
const HEATMAP_WORLD_D = 26;
const HEATMAP_CENTER_Z = 1.0;

export class MarketSceneController {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private materials: SceneMaterialLibrary;
  private floorMesh: THREE.Mesh;
  private compareArenaGroup: THREE.Group;
  private zeroDatumPlane: THREE.Mesh;
  private compareRibbonsGroup: THREE.Group;
  private compareLaneMarkers: THREE.Mesh[] = [];
  private pavilions: Record<ExchangeId, ExchangePavilionParts>;
  private monoliths: Record<string, StockMonolithParts> = {};
  private hitProxies: THREE.Object3D[] = [];
  private callbacks: SceneControllerCallbacks;

  private isSoftwareGl: boolean;
  private maxAnisotropy: number;
  private frameId = 0;
  private disposed = false;
  private lastTime = performance.now();

  private viewMode: ViewMode = 'overview';
  private compareSymbols: string[] = [];
  private metricMode: ComparisonMetricMode = 'pct_change';
  private selectedExchange: ExchangeId | null = null;
  private selectedStock: string | null = null;
  private hoveredId: string | null = null;
  private externalHoveredStock: string | null = null;

  private heatmapMode: HeatmapMode = '3d';
  private heatmapPlaneGeo: THREE.PlaneGeometry;
  private heatmapRgba: Uint8Array;
  private heatmapTexture: THREE.DataTexture;
  private heatmapMat: THREE.MeshStandardMaterial;
  private heatmapMesh: THREE.Mesh;
  private heatmapContourMat: THREE.MeshBasicMaterial;
  private heatmapContourMesh: THREE.Mesh;
  private heatmapTargetElevations: Float32Array;
  private heatmapNeedsAnim = true;

  private particleSystem: MomentumParticleSystem;
  private activeEmitters: ActiveWorldEmitter[] = [];
  private prevStockPrices: Record<string, number> = {};
  private lastEmitterSignature = '';

  private cameraTransitionActive = false;
  private targetCamPos = CAMERA_POSES.panoramic.pos.clone();
  private targetLookAt = CAMERA_POSES.panoramic.target.clone();

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerDownPos = new THREE.Vector2();
  private lastHoverCheck = 0;
  private lastMarketState: MarketSimulationState | null = null;

  private envTexture: THREE.Texture | null = null;
  private cleanupTextures: THREE.Texture[] = [];
  private cleanupGeos: THREE.BufferGeometry[] = [];
  private cleanupMats: THREE.Material[] = [];

  constructor(
    container: HTMLElement,
    callbacks: SceneControllerCallbacks,
    initialState: MarketSimulationState,
    initialCompareSymbols: string[],
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.compareSymbols = initialCompareSymbols;
    this.lastMarketState = initialState;

    // Software WebGL detection from GPU renderer string only
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);

    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';

    // Scene & horizon-matched fog
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0f18);
    this.scene.fog = new THREE.FogExp2(0x0a0f18, 0.0155);

    // Camera
    const aspect = (container.clientWidth || window.innerWidth) / (container.clientHeight || window.innerHeight);
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.25, 220);
    this.camera.position.copy(CAMERA_POSES.panoramic.pos);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 58;
    this.controls.minPolarAngle = 0.2;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.target.copy(CAMERA_POSES.panoramic.target);
    this.controls.addEventListener('start', () => {
      // Never fight manual user camera drag
      this.cameraTransitionActive = false;
    });

    // Studio IBL environment map
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTexture;
    pmremGenerator.dispose();

    // 3-point Warm/Cool Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x8bb8ff, 0x0b1120, 0.72);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.85);
    keyLight.position.set(18, 28, 16);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 75;
    keyLight.shadow.camera.left = -26;
    keyLight.shadow.camera.right = 26;
    keyLight.shadow.camera.top = 26;
    keyLight.shadow.camera.bottom = -26;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.75);
    rimLight.position.set(-20, 14, -18);
    this.scene.add(rimLight);

    // Procedural Textures & Materials
    const floorTex = createFloorGridTexture(this.maxAnisotropy);
    floorTex.repeat.set(26, 26);
    const bumpTex = createBrushedMetalBumpTexture(this.maxAnisotropy);
    const shadowTex = createRadialShadowTexture();
    this.cleanupTextures.push(floorTex, bumpTex, shadowTex);

    this.materials = createSceneMaterialLibrary(this.isSoftwareGl, floorTex, bumpTex, shadowTex);

    // Architectural Observatory Floor Plane (wide so horizon blends seamlessly into fog)
    const floorGeo = new THREE.PlaneGeometry(340, 340);
    floorGeo.rotateX(-Math.PI / 2);
    this.floorMesh = new THREE.Mesh(floorGeo, this.materials.floor);
    this.floorMesh.receiveShadow = true;
    this.scene.add(this.floorMesh);
    this.cleanupGeos.push(floorGeo);

    // 2D-to-3D Activity Heatmap Floor Overlay & Topographic Relief Surface
    const cellCount = HEATMAP_COLS * HEATMAP_ROWS;
    this.heatmapRgba = new Uint8Array(cellCount * 4);
    this.heatmapTargetElevations = new Float32Array(cellCount);
    this.heatmapTexture = new THREE.DataTexture(
      this.heatmapRgba,
      HEATMAP_COLS,
      HEATMAP_ROWS,
      THREE.RGBAFormat,
    );
    this.heatmapTexture.colorSpace = THREE.SRGBColorSpace;
    this.heatmapTexture.magFilter = THREE.LinearFilter;
    this.heatmapTexture.minFilter = THREE.LinearFilter;
    this.heatmapTexture.flipY = true;
    this.heatmapTexture.needsUpdate = true;

    this.heatmapPlaneGeo = new THREE.PlaneGeometry(
      HEATMAP_WORLD_W,
      HEATMAP_WORLD_D,
      HEATMAP_COLS - 1,
      HEATMAP_ROWS - 1,
    );
    this.heatmapPlaneGeo.rotateX(-Math.PI / 2);

    this.heatmapMat = new THREE.MeshStandardMaterial({
      map: this.heatmapTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      roughness: 0.42,
      metalness: 0.12,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.heatmapMesh = new THREE.Mesh(this.heatmapPlaneGeo, this.heatmapMat);
    this.heatmapMesh.position.set(0, 0.045, HEATMAP_CENTER_Z);
    this.heatmapMesh.receiveShadow = true;
    this.scene.add(this.heatmapMesh);

    this.heatmapContourMat = new THREE.MeshBasicMaterial({
      color: 0x94a3b8,
      wireframe: true,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    this.heatmapContourMesh = new THREE.Mesh(this.heatmapPlaneGeo, this.heatmapContourMat);
    this.heatmapContourMesh.position.set(0, 0.052, HEATMAP_CENTER_Z);
    this.scene.add(this.heatmapContourMesh);

    this.cleanupTextures.push(this.heatmapTexture);
    this.cleanupGeos.push(this.heatmapPlaneGeo);
    this.cleanupMats.push(this.heatmapMat, this.heatmapContourMat);

    // Build 3 Exchange Pavilions
    this.pavilions = {
      TSX: createExchangePavilionGroup(
        'TSX',
        EXCHANGE_METADATA.TSX.accentColor,
        'Toronto · CAD',
        EXCHANGE_METADATA.TSX.worldX,
        EXCHANGE_METADATA.TSX.worldZ,
        this.materials,
        this.maxAnisotropy,
      ),
      NASDAQ: createExchangePavilionGroup(
        'NASDAQ',
        EXCHANGE_METADATA.NASDAQ.accentColor,
        'New York · USD',
        EXCHANGE_METADATA.NASDAQ.worldX,
        EXCHANGE_METADATA.NASDAQ.worldZ,
        this.materials,
        this.maxAnisotropy,
      ),
      NYSE: createExchangePavilionGroup(
        'NYSE',
        EXCHANGE_METADATA.NYSE.accentColor,
        'New York · USD',
        EXCHANGE_METADATA.NYSE.worldX,
        EXCHANGE_METADATA.NYSE.worldZ,
        this.materials,
        this.maxAnisotropy,
      ),
    };

    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
      const pav = this.pavilions[exId];
      this.scene.add(pav.group);
      this.hitProxies.push(pav.hitProxy);
    });

    // Build 15 Stock Monoliths arranged in crisp front arcs around each Exchange Pavilion
    const byExchange: Record<ExchangeId, typeof STOCK_CATALOG> = {
      TSX: STOCK_CATALOG.filter((s) => s.exchange === 'TSX'),
      NASDAQ: STOCK_CATALOG.filter((s) => s.exchange === 'NASDAQ'),
      NYSE: STOCK_CATALOG.filter((s) => s.exchange === 'NYSE'),
    };

    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
      const exMeta = EXCHANGE_METADATA[exId];
      const list = byExchange[exId];
      list.forEach((def, idx) => {
        const t = list.length > 1 ? idx / (list.length - 1) : 0.5;
        const arcAngle = (t - 0.5) * Math.PI * 0.74;
        const radius = 5.1;
        const hx = exMeta.worldX + Math.sin(arcAngle) * radius;
        const hz = exMeta.worldZ + Math.cos(arcAngle) * radius * 0.8 + 0.55;
        const monolith = createStockMonolithGroup(
          def,
          new THREE.Vector3(hx, 0, hz),
          this.materials,
        );
        this.monoliths[def.symbol] = monolith;
        this.scene.add(monolith.group);
        this.hitProxies.push(monolith.hitProxy);
      });
    });

    // Build Comparison Arena Stage (centered at x: 0, z: 3.5)
    this.compareArenaGroup = new THREE.Group();
    this.compareArenaGroup.position.set(0, 0, 3.5);
    this.compareArenaGroup.visible = false;

    // Arena stepped glass/metal deck (sits cleanly beneath heatmapMesh y=0.045)
    const arenaDeckGeo = new THREE.BoxGeometry(17.5, 0.036, 11.2);
    const arenaDeckMat = new THREE.MeshStandardMaterial({
      color: 0x111a2b,
      roughness: 0.55,
      metalness: 0.65,
    });
    const arenaDeck = new THREE.Mesh(arenaDeckGeo, arenaDeckMat);
    arenaDeck.position.set(0, 0.018, -1.6);
    arenaDeck.receiveShadow = true;
    this.compareArenaGroup.add(arenaDeck);
    this.cleanupGeos.push(arenaDeckGeo);
    this.cleanupMats.push(arenaDeckMat);

    // 0% Reference Datum Plane floating cleanly at y = 2.0
    const datumGeo = new THREE.PlaneGeometry(16.6, 8.6);
    datumGeo.rotateX(-Math.PI / 2);
    this.zeroDatumPlane = new THREE.Mesh(datumGeo, this.materials.zeroDatumPlane);
    this.zeroDatumPlane.position.set(0, 2.0, -2.0);
    this.compareArenaGroup.add(this.zeroDatumPlane);
    this.cleanupGeos.push(datumGeo);

    // Subtle border frame for 0% Datum Plane
    const datumEdgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(16.6, 0.02, 8.6));
    const datumEdgesMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.35,
    });
    const datumEdges = new THREE.LineSegments(datumEdgesGeo, datumEdgesMat);
    datumEdges.position.copy(this.zeroDatumPlane.position);
    this.compareArenaGroup.add(datumEdges);
    this.cleanupGeos.push(datumEdgesGeo);
    this.cleanupMats.push(datumEdgesMat);

    this.compareRibbonsGroup = new THREE.Group();
    this.compareArenaGroup.add(this.compareRibbonsGroup);
    this.scene.add(this.compareArenaGroup);

    // 3D Momentum Particle System (GPU-friendly single-draw Points ring buffer)
    this.particleSystem = new MomentumParticleSystem(this.scene);

    // Raycast layer 1
    this.raycaster.layers.set(1);

    // Pre-warm shaders on GPU
    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    // Bind events
    this.bindEvents();

    // Sync initial state and pre-warm particles slightly so spikes are immediately visible
    this.syncMarketState(initialState);
    this.particleSystem.update(0.18, this.activeEmitters);

    // Start loop
    this.tick();
  }

  private bindEvents() {
    window.addEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.handlePointerDown);
    dom.addEventListener('pointerup', this.handlePointerUp);
    dom.addEventListener('pointermove', this.handlePointerMove);
    dom.addEventListener('webglcontextlost', this.handleContextLost);
    dom.addEventListener('webglcontextrestored', this.handleContextRestored);
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
  };

  private handleContextRestored = () => {
    if (!this.disposed) {
      this.tick();
    }
  };

  private handleResize = () => {
    if (this.disposed) return;
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    );
  };

  private updatePointerNDC(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private handlePointerDown = (e: PointerEvent) => {
    this.pointerDownPos.set(e.clientX, e.clientY);
  };

  private handlePointerUp = (e: PointerEvent) => {
    const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
    if (dist > 6) return; // Was an orbit drag, not a click

    this.updatePointerNDC(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitProxies, false);
    if (hits.length > 0) {
      const data = hits[0].object.userData;
      if (data.kind === 'exchange' && data.exchangeId) {
        this.callbacks.onSelectExchange(data.exchangeId as ExchangeId);
      } else if (data.kind === 'stock' && data.symbol) {
        this.callbacks.onSelectStock(data.symbol as string);
      }
    }
  };

  private handlePointerMove = (e: PointerEvent) => {
    const now = performance.now();
    if (now - this.lastHoverCheck < 50) return;
    this.lastHoverCheck = now;

    this.updatePointerNDC(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.hitProxies, false);
    if (hits.length > 0) {
      const data = hits[0].object.userData;
      const nextId = data.kind === 'exchange' ? data.exchangeId : data.symbol;
      if (nextId !== this.hoveredId) {
        this.hoveredId = nextId;
        this.renderer.domElement.style.cursor = 'pointer';
        this.callbacks.onHoverItem({ kind: data.kind, id: nextId });
      }
    } else if (this.hoveredId !== null) {
      this.hoveredId = null;
      this.renderer.domElement.style.cursor = 'grab';
      this.callbacks.onHoverItem(null);
    }
  };

  public setCameraPreset(preset: CameraPreset) {
    const pose = CAMERA_POSES[preset];
    this.targetCamPos.copy(pose.pos);
    this.targetLookAt.copy(pose.target);
    this.cameraTransitionActive = true;
  }

  public setViewMode(
    mode: ViewMode,
    compareSymbols: string[],
    metricMode: ComparisonMetricMode,
  ) {
    const modeChanged = this.viewMode !== mode;
    this.viewMode = mode;
    this.compareSymbols = compareSymbols;
    this.metricMode = metricMode;

    this.compareArenaGroup.visible = mode === 'compare';

    if (modeChanged) {
      this.setCameraPreset(mode === 'compare' ? 'compare_front' : 'panoramic');
    }

    if (this.lastMarketState) {
      this.syncMarketState(this.lastMarketState);
    }
  }

  public setSelection(exchangeId: ExchangeId | null, stockSymbol: string | null) {
    this.selectedExchange = exchangeId;
    this.selectedStock = stockSymbol;
  }

  public setHoveredStock(stockSymbol: string | null) {
    this.externalHoveredStock = stockSymbol;
  }

  public setHeatmapMode(mode: HeatmapMode) {
    if (this.heatmapMode === mode) return;
    this.heatmapMode = mode;
    this.heatmapNeedsAnim = true;
  }

  private updateHeatmapField(state: MarketSimulationState) {
    const sources = collectHeatSources(state, this.viewMode, this.compareSymbols);
    const maxAbsPct = computeHeatScaleMax(state);
    const { rgba, elevations } = generateHeatmapFieldData(
      sources,
      maxAbsPct,
      HEATMAP_COLS,
      HEATMAP_ROWS,
      HEATMAP_WORLD_W,
      HEATMAP_WORLD_D,
      HEATMAP_CENTER_Z,
    );
    this.heatmapRgba.set(rgba);
    this.heatmapTexture.needsUpdate = true;
    this.heatmapTargetElevations.set(elevations);
    this.heatmapNeedsAnim = true;
  }

  public syncMarketState(state: MarketSimulationState) {
    this.lastMarketState = state;

    // 1. Update Exchange Pavilions
    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
      const ex = state.exchanges[exId];
      const pav = this.pavilions[exId];
      const targetHeight = THREE.MathUtils.clamp(2.8 + ex.changePct * 0.45, 1.4, 4.6);
      pav.spireCore.scale.y = targetHeight;
      pav.spireCrown.position.y = 1.12 + targetHeight + 0.36;

      if (ex.changePct >= 0.05) {
        pav.spireCoreMat.emissive.copy(_gainColor);
      } else if (ex.changePct <= -0.05) {
        pav.spireCoreMat.emissive.copy(_lossColor);
      } else {
        pav.spireCoreMat.emissive.set(EXCHANGE_METADATA[exId].accentColor);
      }

      updatePavilionRibbonGeometry(pav, ex.history, ex.baseIndex);
    });

    // 2. Update Stock Monoliths target positions, heights, and distinct compare colors
    const compareCount = this.compareSymbols.length;
    const spacing = compareCount <= 2 ? 4.4 : compareCount === 3 ? 3.8 : 3.3;

    for (const def of STOCK_CATALOG) {
      const rt = state.stocks[def.symbol];
      const monolith = this.monoliths[def.symbol];
      if (!rt || !monolith) continue;

      const compareIdx = this.compareSymbols.indexOf(def.symbol);

      if (this.viewMode === 'compare' && compareIdx !== -1) {
        const offsetX = (compareIdx - (compareCount - 1) / 2) * spacing;
        monolith.targetPos.set(offsetX, 0, 5.5);
        monolith.group.visible = true;
        // Distinct signature ticker color on core, semantic gain/loss on crown
        monolith.coreMat.color.copy(monolith.baseColor);
        monolith.coreMat.emissive.copy(monolith.baseColor);
        monolith.crownMat.emissive.copy(rt.changePct >= 0 ? _gainColor : _lossColor);
        monolith.crownMat.emissiveIntensity = 0.75;
      } else if (this.viewMode === 'compare') {
        // Non-compared monoliths retract cleanly out of the Comparison Arena
        monolith.targetPos.set(monolith.homePos.x, -6.5, monolith.homePos.z);
      } else {
        monolith.targetPos.copy(monolith.homePos);
        monolith.group.visible = true;

        if (rt.changePct > 0.15) {
          _colorTarget.copy(_gainColor);
        } else if (rt.changePct < -0.15) {
          _colorTarget.copy(_lossColor);
        } else {
          _colorTarget.set(def.color);
        }
        monolith.coreMat.color.copy(_colorTarget);
        monolith.coreMat.emissive.copy(_colorTarget);
        monolith.crownMat.emissive.copy(monolith.baseColor);
        monolith.crownMat.emissiveIntensity = 0.25;
      }

      monolith.targetScaleY = THREE.MathUtils.clamp(1.85 + rt.changePct * 0.32, 0.45, 3.65);
    }

    // 3. Rebuild 3D Comparison Ribbons when in Compare mode
    this.rebuildComparisonRibbons(state);

    // 4. Refresh 2D-to-3D Activity Heatmap texture & relief elevations
    this.updateHeatmapField(state);

    // 5. Update 3D Momentum Particle Emitters for high-volatility / price-spike stocks
    this.updateMomentumEmitters(state);
  }

  private updateMomentumEmitters(state: MarketSimulationState) {
    const specs = collectMomentumEmitters(
      state,
      this.prevStockPrices,
      this.viewMode,
      this.compareSymbols,
    );

    this.activeEmitters = specs.map((spec) => {
      const m = this.monoliths[spec.symbol];
      const worldX = m ? m.targetPos.x : 0;
      const worldZ = m ? m.targetPos.z : 0;
      const crownY = m ? (0.32 + m.targetScaleY + 0.12) * m.group.scale.y : 2.0;

      const emitter: ActiveWorldEmitter = {
        ...spec,
        x: worldX,
        y: crownY,
        z: worldZ,
      };

      if (spec.isBurst) {
        this.particleSystem.spawnBurst(emitter, 10);
      }
      return emitter;
    });

    for (const def of STOCK_CATALOG) {
      const rt = state.stocks[def.symbol];
      if (rt) {
        this.prevStockPrices[def.symbol] = rt.price;
      }
    }

    const sig = specs.map((s) => s.symbol).join(',');
    if (sig !== this.lastEmitterSignature) {
      this.lastEmitterSignature = sig;
      this.callbacks.onMomentumChange?.(specs.map((s) => s.symbol));
    }
  }

  private rebuildComparisonRibbons(state: MarketSimulationState) {
    // Clear existing comparison ribbons
    while (this.compareRibbonsGroup.children.length > 0) {
      const child = this.compareRibbonsGroup.children[0] as THREE.Mesh;
      this.compareRibbonsGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material && !Array.isArray(child.material)) {
        child.material.dispose();
      }
    }
    this.compareLaneMarkers = [];

    if (this.viewMode !== 'compare' || this.compareSymbols.length === 0) return;

    const compSeries = computeComparisonSeries(state, this.compareSymbols, this.metricMode);
    const count = compSeries.length;
    const spacing = count <= 2 ? 4.4 : count === 3 ? 3.8 : 3.3;

    // Find max magnitude for crisp vertical normalization around y = 2.0 (the 0% datum plane)
    let maxMag = 1.5;
    for (const item of compSeries) {
      for (const v of item.series) {
        const val = this.metricMode === 'indexed_100' ? v - 100 : v;
        if (Math.abs(val) > maxMag) maxMag = Math.abs(val);
      }
    }

    compSeries.forEach((item, idx) => {
      const laneX = (idx - (count - 1) / 2) * spacing;
      const itemColor = new THREE.Color(item.color);

      // Subtle floor lane guide stripe
      const laneGeo = new THREE.PlaneGeometry(1.1, 8.6);
      laneGeo.rotateX(-Math.PI / 2);
      const laneMat = new THREE.MeshBasicMaterial({
        color: itemColor,
        transparent: true,
        opacity: 0.14,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      const laneMesh = new THREE.Mesh(laneGeo, laneMat);
      laneMesh.position.set(laneX, 0.15, -2.0);
      this.compareRibbonsGroup.add(laneMesh);
      this.compareLaneMarkers.push(laneMesh);

      // Build 3D trajectory ribbon from z = -6.0 (oldest) to z = +1.8 (latest near monolith)
      const sampleCount = 28;
      const pts: THREE.Vector3[] = [];
      const step = (item.series.length - 1) / (sampleCount - 1);

      for (let i = 0; i < sampleCount; i++) {
        const sIdx = Math.min(item.series.length - 1, Math.round(i * step));
        const rawVal = item.series[sIdx];
        const centered = this.metricMode === 'indexed_100' ? rawVal - 100 : rawVal;
        const y = THREE.MathUtils.clamp(2.0 + (centered / maxMag) * 1.55, 0.45, 4.1);
        const t = i / (sampleCount - 1);
        const z = THREE.MathUtils.lerp(-6.0, 1.75, t);
        pts.push(new THREE.Vector3(laneX, y, z));
      }

      const curve = new THREE.CatmullRomCurve3(pts);
      const tubeGeo = new THREE.TubeGeometry(curve, 44, 0.1, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: itemColor,
        emissive: itemColor,
        emissiveIntensity: 0.55,
        roughness: 0.22,
        metalness: 0.45,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      tubeMesh.castShadow = !this.isSoftwareGl;
      this.compareRibbonsGroup.add(tubeMesh);

      // Terminal marker sphere at the latest point
      const lastPt = pts[pts.length - 1];
      const dotGeo = new THREE.SphereGeometry(0.18, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: itemColor,
        emissiveIntensity: 0.9,
        roughness: 0.15,
        metalness: 0.3,
      });
      const dotMesh = new THREE.Mesh(dotGeo, dotMat);
      dotMesh.position.copy(lastPt);
      this.compareRibbonsGroup.add(dotMesh);
    });
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || typeof gl.fenceSync !== 'function') {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // 1. Smoothly damp camera preset transitions
    if (this.cameraTransitionActive) {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.targetCamPos.x, 5.5, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.targetCamPos.y, 5.5, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.targetCamPos.z, 5.5, dt);

      this.controls.target.x = THREE.MathUtils.damp(this.controls.target.x, this.targetLookAt.x, 6.0, dt);
      this.controls.target.y = THREE.MathUtils.damp(this.controls.target.y, this.targetLookAt.y, 6.0, dt);
      this.controls.target.z = THREE.MathUtils.damp(this.controls.target.z, this.targetLookAt.z, 6.0, dt);

      if (
        this.camera.position.distanceTo(this.targetCamPos) < 0.05 &&
        this.controls.target.distanceTo(this.targetLookAt) < 0.05
      ) {
        this.cameraTransitionActive = false;
      }
    }

    this.controls.update();

    // 2. Smoothly damp Exchange Pavilions (cleanly retract below stage in compare mode)
    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
      const pav = this.pavilions[exId];
      const targetY = this.viewMode === 'compare' ? -7.0 : 0;
      const targetScale = this.viewMode === 'compare' ? 0.55 : 1.0;
      pav.group.position.y = THREE.MathUtils.damp(pav.group.position.y, targetY, 6, dt);
      const nextS = THREE.MathUtils.damp(pav.group.scale.x, targetScale, 6, dt);
      pav.group.scale.setScalar(nextS);
      pav.group.visible = pav.group.position.y > -5.5;

      const isSelected = this.selectedExchange === exId || this.hoveredId === exId;
      pav.ringMat.emissiveIntensity = THREE.MathUtils.damp(
        pav.ringMat.emissiveIntensity,
        isSelected ? 1.5 : 0.85,
        8,
        dt,
      );
    });

    // 3. Smoothly damp Stock Monolith positions, heights, and selection highlights
    for (const sym of Object.keys(this.monoliths)) {
      const m = this.monoliths[sym];
      m.group.position.x = THREE.MathUtils.damp(m.group.position.x, m.targetPos.x, 6.5, dt);
      m.group.position.y = THREE.MathUtils.damp(m.group.position.y, m.targetPos.y, 6.5, dt);
      m.group.position.z = THREE.MathUtils.damp(m.group.position.z, m.targetPos.z, 6.5, dt);

      if (this.viewMode === 'compare' && !this.compareSymbols.includes(sym)) {
        m.group.visible = m.group.position.y > -4.8;
      } else {
        m.group.visible = true;
      }

      m.currentScaleY = THREE.MathUtils.damp(m.currentScaleY, m.targetScaleY, 7.0, dt);
      m.coreMesh.scale.y = m.currentScaleY;
      m.crownMesh.position.y = 0.32 + m.currentScaleY + 0.12;

      const isSelected =
        this.selectedStock === sym ||
        this.hoveredId === sym ||
        this.externalHoveredStock === sym ||
        (this.viewMode === 'compare' && this.compareSymbols.includes(sym));
      m.coreMat.emissiveIntensity = THREE.MathUtils.damp(
        m.coreMat.emissiveIntensity,
        isSelected ? 0.72 : 0.32,
        8,
        dt,
      );

      const targetScale =
        this.viewMode === 'compare' && this.compareSymbols.includes(sym) ? 1.12 : 1.0;
      const curScale = THREE.MathUtils.damp(m.group.scale.x, targetScale, 7, dt);
      m.group.scale.setScalar(curScale);
    }

    // 3b. Smoothly damp 2D-to-3D Heatmap Overlay opacity & vertex elevation relief
    const targetHeatOpacity =
      this.heatmapMode === 'off' ? 0 : this.heatmapMode === '2d' ? 0.84 : 0.9;
    const targetContourOpacity = this.heatmapMode === '3d' ? 0.14 : 0;
    this.heatmapMat.opacity = THREE.MathUtils.damp(this.heatmapMat.opacity, targetHeatOpacity, 7.5, dt);
    this.heatmapContourMat.opacity = THREE.MathUtils.damp(
      this.heatmapContourMat.opacity,
      targetContourOpacity,
      7.5,
      dt,
    );
    this.heatmapMesh.visible = this.heatmapMat.opacity > 0.015;
    this.heatmapContourMesh.visible = this.heatmapContourMat.opacity > 0.01;

    if (this.heatmapNeedsAnim) {
      const posAttr = this.heatmapPlaneGeo.attributes.position as THREE.BufferAttribute;
      const count = posAttr.count;
      const reliefActive = this.heatmapMode === '3d';
      let maxDelta = 0;

      for (let i = 0; i < count; i++) {
        const curY = posAttr.getY(i);
        const targetY = reliefActive ? this.heatmapTargetElevations[i] : 0;
        const nextY = THREE.MathUtils.damp(curY, targetY, 6.5, dt);
        const diff = Math.abs(nextY - targetY);
        if (diff > maxDelta) maxDelta = diff;
        posAttr.setY(i, nextY);
      }

      posAttr.needsUpdate = true;
      this.heatmapPlaneGeo.computeVertexNormals();

      if (maxDelta < 0.002) {
        for (let i = 0; i < count; i++) {
          posAttr.setY(i, reliefActive ? this.heatmapTargetElevations[i] : 0);
        }
        posAttr.needsUpdate = true;
        this.heatmapPlaneGeo.computeVertexNormals();
        this.heatmapNeedsAnim = false;
      }
    }

    // 3c. Track live crown coordinates on active momentum emitters & step 3D particle ring buffer
    for (let i = 0; i < this.activeEmitters.length; i++) {
      const em = this.activeEmitters[i];
      const m = this.monoliths[em.symbol];
      if (m) {
        em.x = m.group.position.x;
        em.y = m.group.position.y + (0.32 + m.currentScaleY + 0.12) * m.group.scale.y;
        em.z = m.group.position.z;
      }
    }
    this.particleSystem.update(dt, this.activeEmitters);

    // 4. Render frame
    this.renderer.render(this.scene, this.camera);

    // 5. Project 3D world coordinates to screen space for clean DOM labels
    this.emitProjectedLabels();

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  private emitProjectedLabels() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    const out: Record<string, ProjectedLabel> = {};

    // Exchange labels in overview
    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => {
      const pav = this.pavilions[exId];
      _vec3.copy(pav.group.position);
      _vec3.y += 5.4 * pav.group.scale.y;
      _projVec.copy(_vec3).project(this.camera);
      const visible =
        this.viewMode === 'overview' &&
        _projVec.z < 1 &&
        _projVec.x > -1.05 &&
        _projVec.x < 1.05 &&
        _projVec.y > -1.05 &&
        _projVec.y < 1.05;
      out[`ex:${exId}`] = {
        id: exId,
        x: ((_projVec.x + 1) / 2) * width,
        y: ((-_projVec.y + 1) / 2) * height,
        visible,
      };
    });

    // Stock labels for compared stocks (in compare mode) or hovered/selected stock
    for (const sym of Object.keys(this.monoliths)) {
      const m = this.monoliths[sym];
      const showInCompare = this.viewMode === 'compare' && this.compareSymbols.includes(sym);
      const showHovered =
        this.hoveredId === sym || this.externalHoveredStock === sym || this.selectedStock === sym;

      if (!showInCompare && !showHovered) {
        out[`st:${sym}`] = { id: sym, x: 0, y: 0, visible: false };
        continue;
      }

      _vec3.copy(m.group.position);
      _vec3.y += 4.35 * m.group.scale.y;
      _projVec.copy(_vec3).project(this.camera);
      const visible =
        _projVec.z < 1 &&
        _projVec.x > -1.05 &&
        _projVec.x < 1.05 &&
        _projVec.y > -1.05 &&
        _projVec.y < 1.05;

      out[`st:${sym}`] = {
        id: sym,
        x: ((_projVec.x + 1) / 2) * width,
        y: ((-_projVec.y + 1) / 2) * height,
        visible,
      };
    }

    this.callbacks.onLabelsFrame(out);
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);

    window.removeEventListener('resize', this.handleResize);
    const dom = this.renderer.domElement;
    dom.removeEventListener('pointerdown', this.handlePointerDown);
    dom.removeEventListener('pointerup', this.handlePointerUp);
    dom.removeEventListener('pointermove', this.handlePointerMove);
    dom.removeEventListener('webglcontextlost', this.handleContextLost);
    dom.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.controls.dispose();
    this.particleSystem.dispose();
    (['TSX', 'NASDAQ', 'NYSE'] as ExchangeId[]).forEach((exId) => this.pavilions[exId].dispose());
    Object.values(this.monoliths).forEach((m) => m.dispose());
    this.materials.dispose();
    this.cleanupTextures.forEach((t) => t.dispose());
    this.cleanupGeos.forEach((g) => g.dispose());
    this.cleanupMats.forEach((m) => m.dispose());
    if (this.envTexture) this.envTexture.dispose();

    this.renderer.dispose();
    if (dom.parentNode === this.container) {
      this.container.removeChild(dom);
    }
  }
}
