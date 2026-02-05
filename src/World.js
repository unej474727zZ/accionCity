import * as THREE from 'three';
import { AssetLoader } from './AssetLoader.js';
import { CharacterController } from './CharacterController.js';

import { NetworkManager } from './NetworkManager.js';
import { RemotePlayer } from './RemotePlayer.js';

export class World {
  constructor(container) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    // NETWORKING
    this.networkManager = new NetworkManager();
    this.remotePlayers = {}; // Map id -> Mesh

    try {
        // r128 WebGLRenderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: false,
            alpha: false,
            stencil: false,
            depth: true
        });
    } catch (e) {
        document.getElementById('loading').innerHTML = 'Error: Graphics card not supported.<br>Try updating drivers or using a newer device.';
        console.error('Error creating WebGLRenderer:', e);
        return;
    }
    
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    this.assetLoader = new AssetLoader();
    this.character = null;
    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => this.onWindowResize(), false);

    // Initial simple lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(10, 20, 10);
    dirLight.castShadow = true;
    this.scene.add(dirLight);
    
    // Environment
    this.scene.background = new THREE.Color(0x87CEEB); // Sky Blue
    
    // DEBUG: Floor/Grid removed to see City clearly
  }

  async start() {
    document.getElementById('loading').style.display = 'block';
    
    try {
      const assets = await this.assetLoader.loadAll();
      
      // Setup City
      // Setup City
      const cityParams = assets['city'];
      let city = null;
      
      if (cityParams) {
          city = cityParams.scene;
          // SCALE FIX: Increased to 40.0 per user request (Avatar was looking giant)
          city.scale.set(40, 40, 40); 
          
          // TEXTURE FIX: Prevent stretching by repeating textures
          city.traverse((child) => {
              if (child.isMesh && child.material) {
                  // Handle single material or array of materials
                  const materials = Array.isArray(child.material) ? child.material : [child.material];
                  
                  materials.forEach(mat => {
                      if (mat.map) {
                          mat.map.wrapS = THREE.RepeatWrapping;
                          mat.map.wrapT = THREE.RepeatWrapping;
                          mat.map.repeat.set(1.5, 1.5); // "A little bigger" (1.5x larger details than 2.5)
                          mat.needsUpdate = true;
                      }
                  });
              }
          });
          
          this.scene.add(city);
      } else {
          console.warn("City asset missing. Only floor will be visible.");
      }
      
      // ASPHALT FLOOR GENERATION
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#1a1a1a'; // Darker asphalt
      ctx.fillRect(0, 0, 512, 512);
      
      // Add Noise
      for (let i = 0; i < 80000; i++) {
          ctx.fillStyle = Math.random() > 0.5 ? '#333333' : '#000000';
          const x = Math.random() * 512;
          const y = Math.random() * 512;
          ctx.fillRect(x, y, 2, 2);
      }
      
      const asphaltTexture = new THREE.CanvasTexture(canvas);
      asphaltTexture.wrapS = THREE.RepeatWrapping;
      asphaltTexture.wrapT = THREE.RepeatWrapping;
      asphaltTexture.repeat.set(100, 100); 
      
      const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(1000, 1000), // Huge floor
          new THREE.MeshBasicMaterial({ map: asphaltTexture }) 
      );
      floor.name = "AsphaltFloor";
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.05; 
      this.scene.add(floor);
      
      // DEBUG: Add on-screen console for mobile
      // DEBUG: Console removed


      // Setup Character
      this.character = new CharacterController(this.scene, this.camera, assets);
      
      // PASS COLLIDERS
      this.character.colliders = [];
      if (city) {
          this.character.colliders.push(city);
      }
      if (floor) {
          this.character.colliders.push(floor);
      }
      


      // NETWORK: Connect and Setup Events
      this.networkManager.connect();
      
      this.networkManager.onPlayerJoined = (id, data) => {
          console.log("Player Joined:", id);
          if (this.remotePlayers[id]) return; // Already exists
          
          const remotePlayer = new RemotePlayer(this.scene, assets, id, data);
          this.remotePlayers[id] = remotePlayer;
      };
      
      this.networkManager.onPlayerMoved = (id, data) => {
          const remotePlayer = this.remotePlayers[id];
          if (remotePlayer) {
              remotePlayer.updateState(data);
          }
      };
      
      this.networkManager.onPlayerLeft = (id) => {
           console.log("Player Left:", id);
           const remotePlayer = this.remotePlayers[id];
           if (remotePlayer) {
               remotePlayer.dispose();
               delete this.remotePlayers[id];
           }
      };

      document.getElementById('loading').style.display = 'none';
      this.animate();
    } catch (err) {
      console.error('Failed to load game:', err);
      document.getElementById('loading').innerText = 'Error loading assets.';
    }
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    
    // NETWORK: Send Update
    if (this.character) {
        this.networkManager.sendUpdate(
            this.character.mesh.position,
            this.character.yaw,
            this.character.state
        );
    }
    
    const dt = this.clock.getDelta();

    if (this.character) {
        this.character.update(dt);
    }
    
    // Update Remote Players (Animations)
    Object.values(this.remotePlayers).forEach(p => p.update(dt));

    this.renderer.render(this.scene, this.camera);
  }
}
