import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    // Set path to draco decoder (relative to index.html)
    this.dracoLoader.setDecoderPath('draco/');
    this.loader.setDRACOLoader(this.dracoLoader);
    
    this.assets = {};
    this.modelsToLoad = [
      { name: 'city', url: 'models/city_pack_3.glb' },
      // Characters
      { name: 'idle', url: 'models/Idle.glb' },
      { name: 'walk', url: 'models/Walking.glb' },
      { name: 'run', url: 'models/Running.glb' },
      { name: 'backward', url: 'models/BackwardWalk.glb' },
      { name: 'jump', url: 'models/RunningJump.glb' },
      { name: 'firing', url: 'models/FiringRifle.glb' },
      { name: 'shooting', url: 'models/shooting.glb' }, // Walking Shoot

      // Vehicles
      { name: 'car1', url: 'models/car1.glb' },
      { name: 'car2', url: 'models/car2.glb' },
      { name: 'car3', url: 'models/car3.glb' },
      { name: 'motorcycle', url: 'models/motorcycle.glb' },
      { name: 'tank', url: 'models/tank.glb' },
      { name: 'helicopter', url: 'models/helicoptero.glb' },

      // Vehicle Animations
      { name: 'driving', url: 'models/driving.glb' },

      // Weapons (Corrected Mapping: Key 1 -> Pistol, Key 2 -> Rifle)
      { name: 'pistol', url: 'models/pistol.glb' }, // Handgun
      { name: 'rifle', url: 'models/awp.glb' },      // Sniper Rifle

      // Transporters (Missing!)
      { name: 'transporter', url: 'models/transporter.glb' },
      { name: 'transporter1', url: 'models/transporter1.glb' },
      { name: 'transporter2', url: 'models/transporter2.glb' },
      { name: 'transporter3', url: 'models/transporter3.glb' },
      // War Zone Scenery
      { name: 'trash_can', url: 'models/trash_cans.glb' },
      { name: 'tank_wreck', url: 'models/t-80_damaged.glb' },
      { name: 'dumpster1', url: 'models/dumpster.glb' },
      { name: 'dumpster2', url: 'models/dumpster_4k.glb' },
      { name: 'car_wreck_fsc', url: 'models/wrecked_fsc_zuk.glb' },
      { name: 'plane_wreck', url: 'models/crashed_plane.glb' },
      { name: 'moto_wreck', url: 'models/moto_wreck.glb' },
      { name: 'heli_wreck', url: 'models/helicopter_wreck.glb' },
      { name: 'bus_wreck', url: 'models/destroyed_bus.glb' },
      { name: 'plane_interior', url: 'models/dc3_interior.glb' },
      { name: 'car_wreck_group', url: 'models/wrecked_cars_2.glb' },
      { name: 'canister', url: 'models/bombona.glb' }
    ];
  }

  async loadAll() {
    // SEQUENTIAL LOADING
    for (const item of this.modelsToLoad) {
      try {
        await new Promise((resolve, reject) => {
          let isResolved = false;
          
          // Fallback timeout per asset (15 seconds)
          const assetTimeout = setTimeout(() => {
            if (!isResolved) {
              console.warn(`Timeout loading ${item.name}`);
              isResolved = true;
              resolve(null);
            }
          }, 15000);

          this.loader.load(
            `${item.url}?v=${Date.now()}`,
            (gltf) => {
              if (isResolved) return;
              isResolved = true;
              clearTimeout(assetTimeout);
              this.assets[item.name] = gltf;
              const loadingEl = document.getElementById('loading');
              if (loadingEl) loadingEl.innerText = `Loading ${item.name}...`;
              resolve(gltf);
            },
            undefined, 
            (error) => {
              if (isResolved) return;
              isResolved = true;
              clearTimeout(assetTimeout);
              console.error(`Error loading ${item.name}: `, error);
              resolve(null);
            }
          );
        });
      } catch (err) {
        console.warn(`Failed to load ${item.name}, skipping.`);
        this.assets[item.name] = null;
      }
    }

    return this.assets;
  }
}
