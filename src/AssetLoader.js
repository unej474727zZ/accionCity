import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.assets = {};
    this.modelsToLoad = [
      { name: 'city', path: '/models/city_pack_3.glb' },
      { name: 'idle', path: '/models/Idle.glb' },
      { name: 'walk', path: '/models/Walking.glb' },
      { name: 'run', path: '/models/Running.glb' },
      { name: 'backward', path: '/models/BackwardWalk.glb' },
      { name: 'jump', path: '/models/RunningJump.glb' },
    ];
  }

  async loadAll() {
    // SEQUENTIAL LOADING: To prevent choking the network tunnel with 160MB at once
    for (const item of this.modelsToLoad) {
      try {
        await new Promise((resolve, reject) => {
          this.loader.load(
            item.path,
            (gltf) => {
              this.assets[item.name] = gltf;
              // Optional: Update loading UI text if available
              const loadingEl = document.getElementById('loading');
              if (loadingEl) loadingEl.innerText = `Loading ${item.name}...`;
              resolve(gltf);
            },
            undefined, // Progress
            (error) => {
              console.error(`Error loading ${item.name}:`, error);
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
