import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('draco/');
    this.loader.setDRACOLoader(this.dracoLoader);
    
    this.assets = {};
    this.modelsToLoad = [
      { name: 'city', url: 'models/city_pack_3.glb' },
      { name: 'idle', url: 'models/Idle.glb' },
      { name: 'walk', url: 'models/Walking.glb' },
      { name: 'run', url: 'models/Running.glb' },
      { name: 'backward', url: 'models/BackwardWalk.glb' },
      { name: 'jump', url: 'models/RunningJump.glb' },
      { name: 'firing', url: 'models/FiringRifle.glb' },
      { name: 'shooting', url: 'models/shooting.glb' },
      { name: 'car1', url: 'models/car1.glb' },
      { name: 'car2', url: 'models/car2.glb' },
      { name: 'car3', url: 'models/car3.glb' },
      { name: 'motorcycle', url: 'models/motorcycle.glb' },
      { name: 'tank', url: 'models/tank.glb' },
      { name: 'helicopter', url: 'models/helicoptero.glb' },
      { name: 'driving', url: 'models/driving.glb' },
      { name: 'pistol', url: 'models/pistol.glb' },
      { name: 'rifle', url: 'models/awp.glb' },
      { name: 'transporter', url: 'models/transporter.glb' },
      { name: 'transporter1', url: 'models/transporter1.glb' },
      { name: 'transporter2', url: 'models/transporter2.glb' },
      { name: 'transporter3', url: 'models/transporter3.glb' },
      { name: 'trash_can', url: 'models/trash_cans.glb' },
      { name: 'tank_wreck', url: 'models/t-80_damaged.glb' },
      { name: 'dumpster1', url: 'models/dumpster.glb' },
      { name: 'dumpster2', url: 'models/dumpster_4k.glb' },
      { name: 'car_wreck_fsc', url: 'models/wrecked_fsc_zuk.glb' },
      { name: 'canister', url: 'models/bombona.glb' },
      { name: 'bazooka', url: 'models/bazooka.glb' }
    ];
  }

  async loadAll() {
    const loadingEl = document.getElementById('loading');
    let loadedCount = 0;
    const total = this.modelsToLoad.length;

    const loadPromises = this.modelsToLoad.map(item => {
      return new Promise((resolve) => {
        this.loader.load(item.url, (gltf) => {
          this.assets[item.name] = gltf;
          loadedCount++;
          if (loadingEl) loadingEl.innerText = `Cargando Assets: ${Math.round((loadedCount/total)*100)}%`;
          resolve();
        }, undefined, (err) => {
          console.error(`Error loading ${item.name}:`, err);
          resolve();
        });
      });
    });

    await Promise.all(loadPromises);
    if (loadingEl) loadingEl.innerText = "Generando Ciudad...";
    return this.assets;
  }
}
