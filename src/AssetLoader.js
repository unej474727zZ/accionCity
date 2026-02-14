import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
    this.modelsToLoad = [
      { name: 'city', url: '/models/city_pack_3.glb' },
      // Characters
      { name: 'idle', url: '/models/Idle.glb' },
      { name: 'walk', url: '/models/Walking.glb' },
      { name: 'run', url: '/models/Running.glb' },
      { name: 'backward', url: '/models/BackwardWalk.glb' },
      { name: 'jump', url: '/models/RunningJump.glb' },
      { name: 'firing', url: '/models/FiringRifle.glb' },
      { name: 'shooting', url: '/models/shooting.glb' }, // Walking Shoot

      // Cars
      { name: 'car1', url: '/models/car1.glb' },
      { name: 'car2', url: '/models/car2.glb' },
      { name: 'car3', url: '/models/car3.glb' },

      // Weapons (Corrected Mapping: Key 1 -> Pistol, Key 2 -> Rifle)
      { name: 'pistol', url: '/models/pistol.glb' }, // Handgun (was showing as Rifle before?)
      { name: 'rifle', url: '/models/awp.glb' }      // Sniper Rifle (was showing as Pistol before?)
    ];
  }

  async loadAll() {
    // SEQUENTIAL LOADING
    for (const item of this.modelsToLoad) {
      try {
        await new Promise((resolve, reject) => {
          this.loader.load(
            item.url,
            (gltf) => {
              this.assets[item.name] = gltf;
              // Optional: Update loading UI text if available
              const loadingEl = document.getElementById('loading');
              if (loadingEl) loadingEl.innerText = `Loading ${item.name}...`;
              resolve(gltf);
            },
            undefined, // Progress
            (error) => {
              console.error(`Error loading ${item.name}: `, error);
              reject(error);
            }
          );
        });
      } catch (err) {
        console.warn(`Failed to load ${item.name}, using fallback.`);
        // Don't throw, just set as null so the game can continue
        this.assets[item.name] = null;
        // Resolve anyway
      }
    }

    return this.assets;
  }
}
