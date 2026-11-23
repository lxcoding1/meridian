import * as THREE from 'three';
import { MomentumEmitterSpec } from '../simulation/momentumParticles';
import { createParticleSparkTexture } from './textures';

export interface ActiveWorldEmitter extends MomentumEmitterSpec {
  x: number;
  y: number;
  z: number;
}

const MAX_PARTICLES = 420;
const _tmpColor = new THREE.Color();

export class MomentumParticleSystem {
  public readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private sparkTexture: THREE.CanvasTexture;

  private positions = new Float32Array(MAX_PARTICLES * 3);
  private colors = new Float32Array(MAX_PARTICLES * 3);
  private vx = new Float32Array(MAX_PARTICLES);
  private vy = new Float32Array(MAX_PARTICLES);
  private vz = new Float32Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private baseR = new Float32Array(MAX_PARTICLES);
  private baseG = new Float32Array(MAX_PARTICLES);
  private baseB = new Float32Array(MAX_PARTICLES);
  private swirl = new Float32Array(MAX_PARTICLES);

  private cursor = 0;
  private spawnAccum = 0;
  private seed = 1337;
  private activeCount = 0;

  constructor(scene: THREE.Scene) {
    // Park all pool slots cleanly off-stage initially
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.positions[i * 3 + 1] = -60;
      this.age[i] = 1;
      this.life[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(this.positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(this.colors, 3);
    colAttr.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position', posAttr);
    this.geometry.setAttribute('color', colAttr);

    this.sparkTexture = createParticleSparkTexture();
    this.material = new THREE.PointsMaterial({
      size: 0.44,
      sizeAttenuation: true,
      map: this.sparkTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  public spawnBurst(emitter: ActiveWorldEmitter, count: number) {
    for (let i = 0; i < count; i++) {
      this.spawnSingle(emitter);
    }
  }

  private spawnSingle(emitter: ActiveWorldEmitter) {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;

    const angle = this.rand() * Math.PI * 2;
    const radialOffset = 0.22 + this.rand() * 0.36;
    const heightJitter = (this.rand() - 0.35) * 0.7;

    this.positions[idx * 3] = emitter.x + Math.cos(angle) * radialOffset;
    this.positions[idx * 3 + 1] = Math.max(0.5, emitter.y + heightJitter);
    this.positions[idx * 3 + 2] = emitter.z + Math.sin(angle) * radialOffset;

    const radialSpeed = 0.45 + emitter.intensity * 1.15 * (0.5 + this.rand() * 0.7);
    const upBias =
      emitter.direction > 0
        ? 1.8 + emitter.intensity * 2.2
        : emitter.direction < 0
          ? 0.45 + emitter.intensity * 0.85
          : 1.1 + emitter.intensity * 1.4;

    this.vx[idx] = Math.cos(angle) * radialSpeed;
    this.vy[idx] = upBias + this.rand() * 0.9;
    this.vz[idx] = Math.sin(angle) * radialSpeed;
    this.swirl[idx] = (this.rand() > 0.5 ? 1 : -1) * (1.2 + emitter.intensity * 1.8);

    this.age[idx] = 0;
    this.life[idx] = 0.95 + this.rand() * 0.85;

    const hex = this.rand() < 0.7 ? emitter.primaryHex : emitter.secondaryHex;
    _tmpColor.set(hex);
    // Boost slight luminance for crisp additive spark core
    this.baseR[idx] = Math.min(1, _tmpColor.r * 1.15);
    this.baseG[idx] = Math.min(1, _tmpColor.g * 1.15);
    this.baseB[idx] = Math.min(1, _tmpColor.b * 1.15);

    this.colors[idx * 3] = this.baseR[idx];
    this.colors[idx * 3 + 1] = this.baseG[idx];
    this.colors[idx * 3 + 2] = this.baseB[idx];
  }

  public update(dt: number, emitters: ActiveWorldEmitter[]) {
    const safeDt = Math.min(0.08, Math.max(0.001, dt));

    // Continuous emission scaled by aggregate emitter intensity
    if (emitters.length > 0) {
      let totalWeight = 0;
      for (let i = 0; i < emitters.length; i++) {
        totalWeight += 0.4 + emitters[i].intensity * 1.3;
      }
      this.spawnAccum += safeDt * totalWeight * 16;
      const toSpawn = Math.min(18, Math.floor(this.spawnAccum));
      this.spawnAccum -= toSpawn;

      for (let s = 0; s < toSpawn; s++) {
        // Weighted pick across active emitters
        let target = this.rand() * totalWeight;
        let chosen = emitters[0];
        for (let i = 0; i < emitters.length; i++) {
          target -= 0.4 + emitters[i].intensity * 1.3;
          if (target <= 0) {
            chosen = emitters[i];
            break;
          }
        }
        this.spawnSingle(chosen);
      }
    }

    // Advance live particles without heap allocations
    let alive = 0;
    const drag = Math.exp(-1.5 * safeDt);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const maxLife = this.life[i];
      if (maxLife <= 0) continue;

      const nextAge = this.age[i] + safeDt;
      if (nextAge >= maxLife) {
        this.life[i] = 0;
        this.positions[i * 3 + 1] = -60;
        this.colors[i * 3] = 0;
        this.colors[i * 3 + 1] = 0;
        this.colors[i * 3 + 2] = 0;
        continue;
      }

      alive++;
      this.age[i] = nextAge;
      const t = nextAge / maxLife;

      // Apply subtle helical curl in XZ plane
      const curVx = this.vx[i];
      const curVz = this.vz[i];
      const omega = this.swirl[i] * safeDt;
      this.vx[i] = (curVx - curVz * omega) * drag;
      this.vz[i] = (curVz + curVx * omega) * drag;
      this.vy[i] = this.vy[i] * Math.exp(-0.55 * safeDt) + 0.35 * safeDt;

      const pIdx = i * 3;
      this.positions[pIdx] += this.vx[i] * safeDt;
      this.positions[pIdx + 1] += this.vy[i] * safeDt;
      this.positions[pIdx + 2] += this.vz[i] * safeDt;

      // Fade brightness smoothly (AdditiveBlending makes RGB->0 fully transparent)
      const fade = Math.pow(1 - t, 1.35) * (t < 0.12 ? t / 0.12 : 1);
      this.colors[pIdx] = this.baseR[i] * fade;
      this.colors[pIdx + 1] = this.baseG[i] * fade;
      this.colors[pIdx + 2] = this.baseB[i] * fade;
    }

    this.activeCount = alive;
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  public getActiveParticleCount(): number {
    return this.activeCount;
  }

  public dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.sparkTexture.dispose();
  }
}
