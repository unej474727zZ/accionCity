console.log('World.js loaded: VERSION 3.0 (ZERO BOMBER)');
import * as THREE from 'three';
import { VehicleManager } from './VehicleManager.js';
import { AssetLoader } from './AssetLoader.js';
import { CharacterController } from './CharacterController.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { NPCManager } from './NPCManager.js';
import { BotManager } from './BotManager.js';

import { NetworkManager } from './NetworkManager.js';
import { RemotePlayer } from './RemotePlayer.js';
import { WeaponManager } from './WeaponManager.js';
import { Minimap } from './Minimap.js';
import { SoundManager } from './SoundManager.js';
import { SniperManager } from './SniperManager.js';
import { AutoPilot } from './AutoPilot.js';
import { ModularCity } from './ModularCity.js';
import { SnowEffect } from './SnowEffect.js';

// --- CRITICAL AUDIO PATCH (Anti-Crash) ---
// Prevents browser thread lock when Three.js sends non-finite numbers to Web Audio
(function () {
    const originalRamp = AudioParam.prototype.linearRampToValueAtTime;
    AudioParam.prototype.linearRampToValueAtTime = function (value, time) {
        if (!isFinite(value) || !isFinite(time)) return this;
        return originalRamp.call(this, value, time);
    };
    const originalSetValue = AudioParam.prototype.setValueAtTime;
    AudioParam.prototype.setValueAtTime = function (value, time) {
        if (!isFinite(value) || !isFinite(time)) return this;
        return originalSetValue.call(this, value, time);
    };
    const originalSetTarget = AudioParam.prototype.setTargetAtTime;
    if (originalSetTarget) {
        AudioParam.prototype.setTargetAtTime = function (target, startTime, timeConstant) {
            if (!isFinite(target) || !isFinite(startTime) || !isFinite(timeConstant)) return this;
            return originalSetTarget.call(this, target, startTime, timeConstant);
        };
    }
})();

export class World {
    constructor(container) {
        window.world = this;
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 200); // FAR PLANE REDUCED EVEN MORE FOR PERFORMANCE
        this.scene.userData.world = this; // Global access for components

        // NETWORKING
        this.networkManager = new NetworkManager();
        this.remotePlayers = {}; // Map id -> Mesh
        this.soundManager = new SoundManager(this.camera); // Initialize centralized manager
        this.autoPilot = new AutoPilot(this);
        
        // OPTIMIZATION: Auto-save character position every 5 seconds instead of every frame
        setInterval(() => {
            if (this.character && this.character.mesh) {
                const charWorldPos = new THREE.Vector3();
                this.character.mesh.getWorldPosition(charWorldPos);
                localStorage.setItem('characterPosition', JSON.stringify({ x: charWorldPos.x, y: charWorldPos.y, z: charWorldPos.z }));
            }
        }, 5000);

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

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 800;

        // 720p HD Cap: Maximum vertical rendering resolution of 720px on mobile
        const targetMaxHeight = isMobile ? 720 : 1080;
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(1.0, targetMaxHeight / (window.innerHeight * dpr));
        const finalPixelRatio = Math.max(0.65, Math.min(1.0, dpr * scale));

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(finalPixelRatio);
        this.renderer.shadowMap.enabled = !isMobile;
        this.renderer.shadowMap.type = THREE.BasicShadowMap;
        this.renderer.xr.enabled = true; // Enable WebXR
        container.appendChild(this.renderer.domElement);

        // VR Stereo Effect Setup
        this.stereoEffect = new StereoEffect(this.renderer);
        this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
        this.vrMode = false;

        this.assetLoader = new AssetLoader();
        this.character = null;
        this.clock = new THREE.Clock();

        // CONTROLS
        // 1. OrbitControls (Inspection Mode)
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        // this.orbitControls.listenToKeyEvents(window); // REMOVED: Interfere with Character rotation!
        this.orbitControls.enabled = false; // Disabled by default
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.isInspectionMode = false;

        window.addEventListener('resize', () => this.onWindowResize(), false);

        // Environment: Atmospheric Winter / Dense Snow Fog & Night
        const skyColor = 0x141a24; // Cold dark blue atmosphere
        const groundColor = 0x222a34;
        this.scene.background = new THREE.Color(skyColor);

        // Dense fog - navigation by minimap required!
        this.scene.fog = new THREE.Fog(skyColor, 8, 70);

        // Lighting
        const hemiLight = new THREE.HemisphereLight(skyColor, groundColor, 0.7);
        this.scene.add(hemiLight);

        // Directional (Moon / Ambient Cold Light)
        const dirLight = new THREE.DirectionalLight(0xaad4f5, 1.0);
        dirLight.position.set(50, 100, 50); // High sun
        dirLight.castShadow = true; 
        dirLight.shadow.mapSize.width = 1024; // Balanced quality and performance
        dirLight.shadow.mapSize.height = 1024;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 250;
        
        // Tight shadow bounds following character to optimize drawcalls
        const d = 35; 
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;
        dirLight.shadow.bias = -0.0005;
        this.scene.add(dirLight);

        // State Flags
        this.isNightVision = false;
        this.uiVisible = true;
        this.vrMode = false;
        this.arMode = false;
        this.arHitTestSource = null;
        this.arHitTestSourceRequested = false;
        this.arWorldScale = 0.01; // 1:100 scale for the "diorama" effect (Fits on a table)
        this.arOriginalPositions = new Map(); // To restore after AR

        // MAP PANNING STATE
        this.mapPanningOffset = new THREE.Vector3(0, 0, 0);
        this.isDraggingMap = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

        // DEBUG: Floor/Grid removed to see City clearly

        // PERFORMANCE: Reuse common geometries/materials
        this._sharedSmokeGeom = new THREE.SphereGeometry(0.3, 4, 4);
        this._sharedSmokeMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6 });
        this.particles = [];

        // AR RETICLE (Ring to show where the city will be placed)
        this.arReticle = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.8 })
        );
        this.arReticle.visible = false;
        this.scene.add(this.arReticle);

        this.clutterObjects = []; // Track pushable scenery
        this.pickups = []; // Track ammo pickups

        this.isPaused = false;
        this.pausedOverlay = this.createPauseOverlay();
    }

    createPauseOverlay() {
        const div = document.createElement('div');
        div.id = 'pause-overlay';
        div.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(0,0,0,0.6); display: none; flex-direction: column;
            justify-content: center; align-items: center; z-index: 1000000;
            color: white; font-family: 'Arial Black', sans-serif; pointer-events: none;
        `;
        div.innerHTML = `
            <h1 style="font-size: 80px; margin: 0; color: #00ffaa; text-shadow: 0 0 20px #000;">PAUSA</h1>
            <p style="font-size: 18px; color: white;">Presiona START para reanudar</p>
        `;
        document.body.appendChild(div);
        return div;
    }

    async start() {
        document.getElementById('loading').style.display = 'block';

        try {
            const assets = await this.assetLoader.loadAll();

            // Procedural Seed for City (From URL ?seed=... or default 1337)
            const urlParams = new URLSearchParams(window.location.search);
            const seedParam = urlParams.get('seed');
            this.citySeed = seedParam ? parseInt(seedParam) : 1337;
            window.setCitySeed = (newSeed) => {
                const url = new URL(window.location);
                url.searchParams.set('seed', newSeed);
                window.location.href = url.href;
            };

            // BUILD MODULAR CITY (Sector Cero: 3 house types x 3 clones each + billboards + floor graffiti + air access fortress)
            this.modularCity = new ModularCity(this.scene, {
                seed: this.citySeed,
                assets: assets,
                center: new THREE.Vector3(0, 0, 240) // 240m away through the thick snow & fog
            });
            const cityData = this.modularCity.build();
            this.cityBlocks = cityData.cityBlocks;
            this.cityHelipadPos = cityData.helipadPos;

            // Snow particle effect (Atmospheric snow swirling through cold air)
            this.snowEffect = new SnowEffect(this.scene, this.camera, 450);

            // ASPHALT FLOOR GENERATION
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#bebbbb9b'; // Darker asphalt
            ctx.fillRect(0, 0, 512, 512);

            // Add Noise
            for (let i = 0; i < 80000; i++) {
                ctx.fillStyle = Math.random() > 0.5 ? '#546057ff' : '#000000';
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
                new THREE.MeshLambertMaterial({ map: asphaltTexture })
            );
            floor.name = "AsphaltFloor";
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0.01;
            floor.receiveShadow = true;
            this.scene.add(floor);

            // TELEPORTATION PADS
            this.transporters = [];
            const transporterPositions = [
                new THREE.Vector3(430, 0, 430),
                new THREE.Vector3(-430, 0, 430),
                new THREE.Vector3(430, 0, -430),
                new THREE.Vector3(-430, 0, -430)
            ];

            const transporterAsset = assets['transporter'];
            if (transporterAsset) {
                transporterPositions.forEach((pos, i) => {
                    const pad = transporterAsset.scene.clone();
                    pad.position.copy(pos);
                    // Adjusted scale: clearly visible but logical (avatar 0.5w -> pad ~2.5w)
                    pad.scale.set(0.1, 0.2, 0.1);
                    // Ground level (just above floor at 0.05)
                    pad.position.y = 0.06;
                    this.scene.add(pad);
                    this.transporters.push({
                        mesh: pad,
                        pos: pad.position.clone(),
                        timer: 2,
                        triggered: false
                    });
                    console.log(`Transporter ${i} placed at ${pad.position.x}, ${pad.position.z}`);
                });
            }

            this.teleportCooldown = 0;

            // Setup Character
            this.character = new CharacterController(this.scene, this.camera, assets, this);

            // Register transporters as colliders so they are solid
            this.transporters.forEach(t => {
                t.mesh.traverse(child => {
                    if (child.isMesh) this.character.colliders.push(child);
                });
            });

            // REGISTER MODULAR CITY COLLIDERS (Sector Cero)
            if (cityData && cityData.colliders) {
                cityData.colliders.forEach(c => this.character.colliders.push(c));
                console.log(`Registered ${cityData.colliders.length} ModularCity colliders. Blocks: ${this.cityBlocks.length}.`);
            }

            // LOAD CHARACTER POSITION
            // RESCUE PROTOCOL: Force a fresh safe spawn once to get out of buildings
            localStorage.removeItem('characterPosition');
            console.log("World: System Ready. Forced Reset for Rescue.");

            this.camera.lookAt(this.character.mesh.position);

            // AUDIO LISTENER (Using the one from SoundManager to avoid conflicts)
            this.audioListener = this.soundManager.listener;

            // Unlock AudioContext on mobile (browsers block audio until interaction)
            const unlockAudio = () => {
                if (this.soundManager) {
                    this.soundManager.resumeContext();
                }
                document.removeEventListener('touchstart', unlockAudio);
                document.removeEventListener('click', unlockAudio);
            };
            document.addEventListener('touchstart', unlockAudio, { once: true });
            document.addEventListener('click', unlockAudio, { once: true });

            // Pause Audio when App is Minimized (Backgrounded)
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    if (this.audioListener.context.state === 'running') {
                        this.audioListener.context.suspend();
                        console.log("App minimized: Audio paused.");
                    }
                } else {
                    if (this.audioListener.context.state === 'suspended') {
                        this.audioListener.context.resume();
                        console.log("App active: Audio resumed.");
                    }
                }
            });

            // NPC MANAGER
            this.npcManager = new NPCManager(this.scene, assets);
            // Optimized density for RAM and performance
            this.npcManager.initParkedCars(8);

            // BOT MANAGER (Deathmatch)
            this.botManager = new BotManager(this.scene, assets, this);

            // WEAPON MANAGER (EMOTION!!!)
            this.weaponManager = new WeaponManager(this.scene, this.character, this.camera, assets);

            // LINK CONTROLLER TO WEAPON MANAGER
            this.character.weaponManager = this.weaponManager;

            // MINIMAP & RADAR WAYPOINT
            this.minimap = new Minimap(this.cityBlocks, this.camera);
            if (this.cityHelipadPos) {
                this.minimap.targetWaypoint = this.cityHelipadPos;
            }

            // SNIPERS (Hidden NPCs)
            this.sniperManager = new SniperManager(this);

            // MINIMAP 3D CAMERA
            this.minimapSpan = 80; // Default span
            this.minimapCamera = new THREE.OrthographicCamera(-this.minimapSpan, this.minimapSpan, this.minimapSpan, -this.minimapSpan, 1, 1000);
            this.minimapCamera.position.set(0, 300, 0);
            this.minimapCamera.up.set(0, 0, -1); // North points UP on the 2D plane
            this.minimapCamera.lookAt(0, 0, 0); // Straight down

            // VEHICLE MANAGER
            this.vehicleManager = new VehicleManager(this.scene, assets, this.character);

            // SCENERY GROUP FOR SPAWN CHECKS
            this.spawnTargets = [];
            if (this.modularCity) this.spawnTargets.push(this.modularCity.group);
            if (floor) this.spawnTargets.push(floor);

            // DEBUG SPAWN
            const getSafeCityPos = () => {
                const x = (Math.random() - 0.5) * 400;
                const z = (Math.random() - 0.5) * 400;
                console.log(`Spawn: Simple point at ${x}, ${z}`);
                return new THREE.Vector3(x, 0.5, z);
            };

            // Sync collisions
            this.updateRemoteColliders();



            this.trashCans = [];
            this.explosiveCanisters = [];
            this.particles = [];
            this.spawnTargets = this.spawnTargets || [];

            // --- SHARED MATERIALS & GEOMETRIES FOR RAM OPTIMIZATION ---
            const sharedCanisterMaterial = new THREE.MeshStandardMaterial({
                color: 0xff0000,
                emissive: 0x440000,
                roughness: 0.4,
                metalness: 0.2
            });

            // --- WAR ZONE ENVIRONMENT SATURATION (OPTIMIZED) ---
            const addScenery = (name, pos, rot = new THREE.Euler(), scale = 1.0, isExplosive = false) => {
                const asset = assets[name];
                if (!asset) return null;
                const mesh = asset.scene.clone();
                mesh.position.copy(pos);
                mesh.rotation.copy(rot);
                mesh.scale.set(scale, scale, scale);

                // Disable expensive dynamic shadow passes for small clutter props to save mobile GPU
                mesh.traverse(child => {
                    if (child.isMesh) {
                        child.castShadow = false;
                        child.receiveShadow = false;
                    }
                });

                this.scene.add(mesh);
                this.character.colliders.push(mesh);
                this.spawnTargets.push(mesh);

                if (isExplosive) {
                    mesh.userData.isExplosive = true;
                    mesh.userData.hp = 1;
                    const canisterData = { mesh, exploded: false };
                    this.explosiveCanisters.push(canisterData);
                    if (this.weaponManager) {
                        this.weaponManager.canisters.push(canisterData);
                    }

                    // Assign SHARED red material (Zero material clones in GPU memory)
                    if (name === 'canister') {
                        mesh.traverse(child => {
                            if (child.isMesh) {
                                child.material = sharedCanisterMaterial;
                            }
                        });
                    }
                }
                return mesh;
            };

            // --- SEEDED RANDOM FOR SYNCHRONIZATION ---
            let decorationSeed = 42; // Fixed seed for all clients
            const seededRandom = () => {
                decorationSeed = (decorationSeed * 9301 + 49297) % 233280;
                return decorationSeed / 233280;
            };

            // FAST SPAWN HELPER (AABB Math instead of Raycasting)
            const getSafeStreetPos = (range = 800) => {
                for (let i = 0; i < 25; i++) {
                    const x = (seededRandom() - 0.5) * range;
                    const z = (seededRandom() - 0.5) * range;

                    let isInsideBuilding = false;
                    for (const block of this.cityBlocks) {
                        if ((block.maxX - block.minX) > 200 || (block.maxZ - block.minZ) > 200) continue;
                        if (x > block.minX - 1.5 && x < block.maxX + 1.5 &&
                            z > block.minZ - 1.5 && z < block.maxZ + 1.5) {
                            isInsideBuilding = true;
                            break;
                        }
                    }

                    if (!isInsideBuilding) {
                        return new THREE.Vector3(x, 0, z);
                    }
                }
                return null;
            };

            // 1. DUMPSTERS SNAPPED TO LOW BUILDINGS (ROOFTOP ACCESS!)
            // Sort blocks by height/roof level ascending to pick the lowest structures in the city
            const sortedBlocks = [...this.cityBlocks]
                .filter(b => (b.maxX - b.minX) > 2 && (b.maxZ - b.minZ) > 2 && b.maxY > 1.0)
                .sort((a, b) => a.maxY - b.maxY);

            console.log(`🧗 City building roof heights range from ${sortedBlocks[0]?.maxY.toFixed(1)}m to ${sortedBlocks[sortedBlocks.length - 1]?.maxY.toFixed(1)}m. Selected lowest ${Math.min(24, sortedBlocks.length)}.`);

            let dumpstersPlaced = 0;
            // Place dumpsters along perimeter walls of low buildings
            for (let i = 0; i < sortedBlocks.length && dumpstersPlaced < 24; i++) {
                const b = sortedBlocks[i];
                const side = i % 4; // Distribute across south, north, east, west walls
                let posX = b.centerX;
                let posZ = b.centerZ;
                let rot = 0;

                if (side === 0) { // South wall
                    posZ = b.maxZ + 1.2;
                    rot = Math.PI;
                } else if (side === 1) { // North wall
                    posZ = b.minZ - 1.2;
                    rot = 0;
                } else if (side === 2) { // East wall
                    posX = b.maxX + 1.2;
                    rot = -Math.PI / 2;
                } else { // West wall
                    posX = b.minX - 1.2;
                    rot = Math.PI / 2;
                }

                const dPos = new THREE.Vector3(posX, 0.05, posZ);
                const dMesh = addScenery('dumpster1', dPos, new THREE.Euler(0, rot, 0), 0.8);
                if (dMesh) {
                    dMesh.userData.isTrashCan = true;
                    dMesh.userData.hp = 25;
                    dMesh.userData.pushVelocity = new THREE.Vector3(0, 0, 0);
                    this.clutterObjects.push(dMesh);
                    dumpstersPlaced++;

                    // A) Place a red explosive canister right next to this dumpster!
                    const canOffset = (side === 0 || side === 1) 
                        ? new THREE.Vector3(2.0, 0.4, 0) 
                        : new THREE.Vector3(0, 0.4, 2.0);
                    const canPos = dPos.clone().add(canOffset);
                    const canMesh = addScenery('canister', canPos, new THREE.Euler(0, 0, 0), 0.6, true);
                    if (canMesh) {
                        canMesh.userData.pushVelocity = new THREE.Vector3(0, 0, 0);
                        this.clutterObjects.push(canMesh);
                    }

                    // B) Place a trash can on the opposite side of the dumpster!
                    const tcOffset = (side === 0 || side === 1) 
                        ? new THREE.Vector3(-2.0, 0, 0) 
                        : new THREE.Vector3(0, 0, -2.0);
                    const tcPos = dPos.clone().add(tcOffset);
                    const tcMesh = addScenery('trash_can', tcPos, new THREE.Euler(0, seededRandom() * Math.PI, 0), 0.6, false);
                    if (tcMesh) {
                        tcMesh.userData.isTrashCan = true;
                        tcMesh.userData.hp = 5;
                        tcMesh.userData.pushVelocity = new THREE.Vector3(0, 0, 0);
                        this.clutterObjects.push(tcMesh);
                    }
                }
            }

            // 2. STREET EXPLOSIVE CACHES (Bombonas rojas en esquinas y callejones activos)
            let canistersSpawned = dumpstersPlaced; // Already placed 1 per dumpster!
            let attempts = 0;
            // Spawn 30 more canisters in active combat radius (350m) in clusters of 2
            while (canistersSpawned < 55 && attempts < 100) {
                attempts++;
                const streetPos = getSafeStreetPos(350);
                if (streetPos) {
                    // Spawn pair of canisters (fuel cache)
                    for (let k = 0; k < 2 && canistersSpawned < 55; k++) {
                        const offset = new THREE.Vector3((k === 0 ? -0.8 : 0.8), 0.4, (seededRandom() - 0.5) * 0.6);
                        const cPos = streetPos.clone().add(offset);
                        const cMesh = addScenery('canister', cPos, new THREE.Euler(0, seededRandom() * Math.PI, 0), 0.6, true);
                        if (cMesh) {
                            cMesh.userData.pushVelocity = new THREE.Vector3(0, 0, 0);
                            this.clutterObjects.push(cMesh);
                            canistersSpawned++;
                        }
                    }
                }
            }
            console.log(`🧨 Total Spawned: ${canistersSpawned} Explosive Canisters & ${dumpstersPlaced} Dumpsters snapped to low roofs!`);

            // 3. Wrecks (10 instances in streets)
            for (let i = 0; i < 10; i++) {
                const pos = getSafeStreetPos(400);
                if (pos) {
                    const type = seededRandom();
                    let mesh = null;
                    if (type < 0.4) {
                        mesh = addScenery('tank_wreck', pos, new THREE.Euler(0, seededRandom() * Math.PI, 0), 0.05);
                    } else {
                        mesh = addScenery('car_wreck_fsc', pos, new THREE.Euler(0, seededRandom() * Math.PI, 0), 0.1);
                    }
                }
            }

            // 5. Procedural Bazooka Ammo Pickups (Optimized: 15 instances, shared geoms/mats)
            const ammoGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.8, 8);
            ammoGeom.rotateX(Math.PI / 2);
            const ammoMat = new THREE.MeshStandardMaterial({
                color: 0x00ff00,
                emissive: 0x00aa00,
                metalness: 0.8,
                roughness: 0.2
            });
            const glowGeom = new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8);
            glowGeom.rotateX(Math.PI / 2);
            const glowMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending });

            for (let i = 0; i < 15; i++) {
                const pos = getSafeStreetPos();
                if (pos) {
                    pos.y = 1.0;
                    const mesh = new THREE.Mesh(ammoGeom, ammoMat);
                    mesh.position.copy(pos);

                    const glowMesh = new THREE.Mesh(glowGeom, glowMat);
                    mesh.add(glowMesh);

                    this.scene.add(mesh);
                    this.pickups.push({ mesh, type: 'bazooka', startY: pos.y, timeOffset: seededRandom() * Math.PI * 2 });
                }
            }

            // PASS COLLIDERS
            if (city) this.character.colliders.push(city);
            if (floor) this.character.colliders.push(floor);

            // --- CRITICAL FIX: CACHE STATIC COLLIDERS AFTER CITY IS ADDED ---
            this._cachedStaticBoxes = null;
            this.updateRemoteColliders();

            // NETWORK: Connect and Setup Events
            this.networkManager.connect();

            // IMMEDIATE INITIAL SYNC: Override server default with local random spawn
            if (this.character && this.networkManager) {
                this.networkManager.sendUpdate(
                    this.character.mesh.position, 
                    this.character.yaw, 
                    this.character.pitch || 0,
                    this.character.state,
                    this.weaponManager ? this.weaponManager.currentWeaponType : 'pistol',
                    this.weaponManager ? this.weaponManager.isFiring : false
                );
            }

            this.networkManager.onPlayerJoined = (id, data) => {
                console.log("Player Joined:", id);
                if (this.remotePlayers[id]) return; // Already exists
                const remotePlayer = new RemotePlayer(this.scene, assets, id, data, this);
                this.remotePlayers[id] = remotePlayer;
                this.updateRemoteColliders(); // Sync with key systems
            };

            this.networkManager.onPlayerMoved = (id, data) => {
                const remotePlayer = this.remotePlayers[id];
                if (remotePlayer && data.x !== undefined) remotePlayer.updateState(data);
            };

            this.networkManager.onPlayerLeft = (id) => {
                console.log("Player Left:", id);
                const remotePlayer = this.remotePlayers[id];
                if (remotePlayer) {
                    remotePlayer.dispose();
                    delete this.remotePlayers[id];
                    this.updateRemoteColliders(); // Sync with key systems
                }
            };

            this.networkManager.onLocalPlayerIdentified = (data) => {
                console.log("Local Player Identified Name:", data.name);
                const nameEl = document.getElementById('cyberpunk-player-name');
                const cardEl = document.getElementById('cyberpunk-player-card');
                if (nameEl && cardEl) {
                    nameEl.innerText = data.name;
                    cardEl.style.opacity = '1';
                }
            };

            // Sincronización Dictatorial de Vehículos (Cyberpunk Style)
            this.networkManager.onEnterVehicleSuccess = (data) => {
                const vehicleId = data.vehicleId;
                console.log(`[NETWORK-VEHICLE] Entry approved for ${vehicleId}`);
                if (this.vehicleManager && this.vehicleManager.pendingVehicleToEnter) {
                    this.vehicleManager.executeEnterVehicle(this.vehicleManager.pendingVehicleToEnter);
                    this.vehicleManager.pendingVehicleToEnter = null;
                }
            };

            this.networkManager.onEnterVehicleFailure = (data) => {
                const vehicleId = data.vehicleId;
                const reason = data.reason;
                console.warn(`[NETWORK-VEHICLE] Entry rejected for ${vehicleId}. Reason: ${reason}`);
                this.vehicleManager.pendingVehicleToEnter = null;

                // --- ESTÉTICA VISUAL PREMIUM: GLOWING TEXT ONLY ---
                const existing = document.getElementById('cyberpunk-vehicle-notification');
                if (existing) existing.remove();

                const notif = document.createElement('div');
                notif.id = 'cyberpunk-vehicle-notification';
                notif.style.position = 'absolute';
                notif.style.bottom = '22%';
                notif.style.left = '50%';
                notif.style.transform = 'translateX(-50%) translateY(30px)';
                notif.style.color = '#00ffaa'; // Cyberpunk neon green
                notif.style.fontFamily = "'Courier New', Courier, monospace";
                notif.style.fontSize = '24px'; // Aumentado para mayor impacto
                notif.style.fontWeight = '900';
                notif.style.letterSpacing = '3px';
                notif.style.textShadow = '0 0 10px #00ffaa, 0 0 20px #00ffaa, 0 0 30px #00aaff';
                notif.style.zIndex = '100000';
                notif.style.textAlign = 'center';
                notif.style.pointerEvents = 'none';
                notif.style.opacity = '0';
                notif.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out';

                notif.innerHTML = reason;

                document.body.appendChild(notif);

                // Animate In
                setTimeout(() => {
                    notif.style.opacity = '1';
                    notif.style.transform = 'translateX(-50%) translateY(0)';
                }, 20);

                // Animate Out
                setTimeout(() => {
                    notif.style.opacity = '0';
                    notif.style.transform = 'translateX(-50%) translateY(-25px)';
                    setTimeout(() => notif.remove(), 250);
                }, 4000);
            };

            this.networkManager.onVehicleStateUpdate = (serverVehicles) => {
                if (!this.vehicleManager || !this.character) return;

                for (const vehicleId in serverVehicles) {
                    const serverV = serverVehicles[vehicleId];
                    const localV = this.vehicleManager.vehicles.find(v => v.id === vehicleId);
                    if (!localV) continue;

                    // If we are currently driving it, we are the authority for position/rotation
                    if (this.character.isDriving && this.character.vehicle === localV) {
                        continue; // We are driving, so we are the authority for position/rotation
                    }

                    if (serverV.occupiedBy !== null) {
                        // Someone else is driving it! Hide the parked version
                        localV.mesh.visible = false;
                        
                        // Detach Positional audio of the parked car to keep it quiet
                        if (localV.engineSoundDrive && localV.engineSoundDrive.isPlaying) {
                            localV.engineSoundDrive.stop();
                        }
                        if (localV.engineSoundStartup && localV.engineSoundStartup.isPlaying) {
                            localV.engineSoundStartup.stop();
                        }
                    } else {
                        // The vehicle is parked! Make it visible and sync its location
                        localV.mesh.visible = true;
                        localV.mesh.position.set(serverV.x, serverV.y, serverV.z);
                        localV.mesh.rotation.y = serverV.yaw;

                        // Recalculate collision bounding box at its new position
                        localV.collider.setFromObject(localV.mesh);
                    }
                }
            };

            // Eliminado el escuchador de pausa global

            // COMBAT SYNC
            this.networkManager.onPlayerShoot = (data) => {
                const remote = this.remotePlayers[data.id];
                if (remote) {
                    remote.shoot(data.origin, data.direction, data.weaponType);
                }
            };

            this.networkManager.onPlayerHit = (data) => {
                if (this.weaponManager) {
                    const hitPos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);

                    // Blood on hit location (victim or wall)
                    this.weaponManager.createImpact(hitPos, new THREE.Vector3(0, 1, 0), data.type, data.scale);

                    // --- DETECTION FOR LOCAL PLAYER ---
                    if (this.character && this.character.mesh && !this.character.isDead) {
                        const distToMe = hitPos.distanceTo(this.character.mesh.position);
                        // Increased range to 3.0m to catch headshots (mesh origin is at feet)
                        if (distToMe < 3.0) {
                            this.character.takeDamage(1);
                            // Create extra blood effect right in front of camera for feedback
                            this.weaponManager.createImpact(hitPos, new THREE.Vector3(0, 1, 0), 'blood', 2.0);
                        }
                    }
                }
            };

            // CHAT SYSTEM
            const chatInput = document.getElementById('chat-input');
            const chatMessages = document.getElementById('chat-messages');

            // --- CYBERPUNK RESPAWN BUTTON EVENTS ---
            const respawnBtn = document.getElementById('respawn-btn');
            if (respawnBtn) {
                respawnBtn.addEventListener('click', () => {
                    if (this.character) this.character.respawn();
                });
            }

            const btnStart = document.getElementById('btn-start');
            if (btnStart) {
                const handleStartTrigger = (e) => {
                    e.preventDefault();
                    if (this.character && this.character.isDead) {
                        this.character.respawn();
                    }
                };
                btnStart.addEventListener('touchstart', handleStartTrigger);
                btnStart.addEventListener('mousedown', handleStartTrigger);
            }

            // STATUS INDICATOR
            const statusEl = document.createElement('div');
            statusEl.style.position = 'absolute';
            statusEl.style.top = '10px';
            statusEl.style.left = '50%';
            statusEl.style.transform = 'translateX(-50%)';
            statusEl.style.color = 'red';
            statusEl.style.fontWeight = 'bold';
            statusEl.style.fontSize = '14px';
            statusEl.style.zIndex = '1000';
            statusEl.style.display = 'none';
            document.body.appendChild(statusEl);

            this.networkManager.socket.on('connect', () => {
                statusEl.innerText = 'ONLINE';
                statusEl.style.color = 'lime';
                setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
            });

            this.networkManager.socket.on('disconnect', () => {
                statusEl.innerText = 'DISCONNECTED';
                statusEl.style.color = 'red';
                statusEl.style.display = 'block';
            });

            this.networkManager.onChatMessage = (data) => {
                const msg = document.createElement('div');
                msg.className = 'chat-msg';
                msg.style.color = data.color || 'white';
                msg.innerHTML = `<strong>${data.name}:</strong> ${data.text}`;
                chatMessages.appendChild(msg);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            };

            // COMBAT EVENTS
            this.networkManager.onPlayerShoot = (data) => {
                if (data.id === this.networkManager.id) return;
                const remotePlayer = this.remotePlayers[data.id];
                if (remotePlayer) {
                    if (['tank', 'bazooka', 'helicopter_missile'].includes(data.weaponType) && this.weaponManager) {
                        this.weaponManager.spawnRemoteProjectile(data.origin, data.direction, data.weaponType, data.id);
                    } else {
                        remotePlayer.shoot(data.origin, data.direction, data.weaponType);
                    }
                }
            };



            if (chatInput) {
                chatInput.addEventListener('keydown', (e) => e.stopPropagation());
                chatInput.addEventListener('keyup', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        const text = chatInput.value.trim();
                        if (text) {
                            this.networkManager.sendChat(text);
                            chatInput.value = '';
                            chatInput.blur();
                        }
                    }
                });
            }

            document.getElementById('loading').style.display = 'none';

            // UI Toggle State
            this.uiVisible = true;
            window.addEventListener('keydown', (e) => {
                if (e.code === 'KeyP') this.toggleUI();

                // INSPECTION MODE (I)
                if (e.code === 'KeyI') {
                    this.isInspectionMode = !this.isInspectionMode;
                    this.orbitControls.enabled = this.isInspectionMode;

                    if (this.isInspectionMode) {
                        document.exitPointerLock();
                        const targetObj = this.character.mesh;
                        if (targetObj) {
                            const targetPos = targetObj.position.clone().add(new THREE.Vector3(0, 0.5, 0));
                            this.orbitControls.target.copy(targetPos);
                            this.orbitControls.update();
                        }
                    } else {
                        document.body.requestPointerLock();
                    }
                }
                if (e.code === 'KeyM') {
                    if (this.minimap) {
                        this.minimap.toggleUI();
                        if (!this.minimap.isFullMap) this.mapPanningOffset.set(0, 0, 0);
                        if (this.minimap.isFullMap) document.exitPointerLock();
                        else document.body.requestPointerLock();
                    }
                }

                if (e.code === 'Equal' || e.code === 'NumpadAdd') this.updateMinimap3DZoom(0.2);
                if (e.code === 'Minus' || e.code === 'NumpadSubtract') this.updateMinimap3DZoom(-0.2);
            });

            // MOUSE DRAGGING FOR MAP PANNING
            const handleMouseDown = (e) => {
                if (this.minimap && this.minimap.isFullMap) {
                    this.isDraggingMap = true;
                    this.lastMouseX = e.clientX;
                    this.lastMouseY = e.clientY;
                }
            };

            const handleMouseMove = (e) => {
                if (this.isDraggingMap && this.minimap && this.minimap.isFullMap) {
                    const dx = e.clientX - this.lastMouseX;
                    const dy = e.clientY - this.lastMouseY;
                    const sens = this.minimapSpan / 400;
                    this.mapPanningOffset.x -= dx * sens;
                    this.mapPanningOffset.z -= dy * sens;
                    this.lastMouseX = e.clientX;
                    this.lastMouseY = e.clientY;
                    e.preventDefault();
                }
            };

            const handleMouseUp = () => { this.isDraggingMap = false; };

            document.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('blur', handleMouseUp);

            window.addEventListener('wheel', (e) => {
                if (!this.minimap) return;
                const delta = e.deltaY > 0 ? -0.5 : 0.5;
                if (this.minimap.isFullMap) {
                    this.updateMinimap3DZoom(delta);
                } else {
                    if (this.character) {
                        const minFOV = (this.character.isDriving && this.character.vehicle && this.character.vehicle.type === 'helicopter') ? 5 : 10;
                        this.character.desiredFOV = THREE.MathUtils.clamp(this.character.desiredFOV - (delta * 50), minFOV, 75);
                        if (document.pointerLockElement || this.character.isDriving) {
                            this.character.cameraDistance = THREE.MathUtils.clamp(this.character.cameraDistance - (delta * 10), 0.1, 15.0);
                        }
                    }
                }
            }, { passive: true });

            // --- FINAL SPAWN ---
            // Spawn vehicles in designated departure positions
            this.vehicleManager.spawnVehicle('helicopter', new THREE.Vector3(12, 0.5, 12), null, 'vehicle_helicopter');
            this.vehicleManager.spawnVehicle('motorcycle', new THREE.Vector3(-10, 0.5, 12), null, 'vehicle_motorcycle');
            this.vehicleManager.spawnVehicle('tank', new THREE.Vector3(-22, 0.5, 22), null, 'vehicle_tank');

            // Departure Helipad at (12, 0.05, 12)
            this.createDepartureHeliBase();

            // Set camera to player using the real character spawn position
            const charSpawn = this.character.mesh.position;
            this.camera.position.copy(charSpawn).add(new THREE.Vector3(0, 5.5, 10));
            this.camera.lookAt(charSpawn);

            // CRITICAL: HIDE LOADING SCREEN
            const loadingScreen = document.getElementById('loading');
            if (loadingScreen) loadingScreen.style.display = 'none';

            this.animate();
        } catch (err) {
            console.error('Failed to load game:', err);
            document.getElementById('loading').innerText = 'Error loading assets.';
        }
    }

    updateMinimap3DZoom(delta) {
        if (!this.minimapCamera) return;
        this.minimapSpan = THREE.MathUtils.clamp(this.minimapSpan - delta * 40, 40, 400);
        this.minimapCamera.left = -this.minimapSpan;
        this.minimapCamera.right = this.minimapSpan;
        this.minimapCamera.top = this.minimapSpan;
        this.minimapCamera.bottom = -this.minimapSpan;
        this.minimapCamera.updateProjectionMatrix();
    }

    updateRemoteColliders() {
        if (!this.character || !this.weaponManager) return;

        let dynamicColliders = Object.values(this.remotePlayers).map(p => p.mesh).filter(m => m);
        if (this.vehicleManager) {
            dynamicColliders = dynamicColliders.concat(this.vehicleManager.vehicles.map(v => v.mesh).filter(m => m));
        }
        if (this.npcManager && this.npcManager.cars) {
            dynamicColliders = dynamicColliders.concat(this.npcManager.cars.filter(m => m));
        }
        if (this.botManager) {
            dynamicColliders = dynamicColliders.concat(this.botManager.bots.map(b => b.hitBox).filter(m => m));
        }

        this.character.remoteColliders = dynamicColliders;

        // CONSOLIDATED COLLIDER LIST for Character Physics (Performance!)
        let dynamicTargets = [...dynamicColliders];
        if (this.clutterObjects) {
            dynamicTargets = dynamicTargets.concat(this.clutterObjects);
        }

        // SPATIAL CULLING & BOUNDING BOX GENERATION
        const playerPos = this.character.mesh.position;
        const cullRadiusSq = 80 * 80; // 80m radius
        
        let filteredTargets = [];
        let physicsBoxes = [];

        // 1. PROCESS STATIC COLLIDERS (City blocks, etc) - Cached!
        if (!this._cachedStaticBoxes) {
            this._cachedStaticBoxes = [];
            this._cachedStaticTargets = [];
            
            // To fix lag: We pre-calculate ONE merged Box3 per static object,
            // instead of storing 1000s of sub-meshes for raycasting.
            for (const obj of this.character.colliders) {
                     //if (!obj || 
                       // obj.name.includes("Sketchfab_Scene") || 
                        //obj.name.includes("Material") || 
                        //obj.name.includes("AsphaltFloor") || 
                        //obj.name.includes("Cube003_")) {
                        //continue; // Ignora el suelo y los grupos gigantes, evitando el muro invisible
                        if (!obj || obj.name === "Sketchfab_Scene" || obj.name === "AsphaltFloor") {
                            continue;                     
                    }
                this._cachedStaticTargets.push(obj);
                
                obj.updateMatrixWorld(true);
                const bbox = new THREE.Box3().setFromObject(obj);
                
                // Add some safety padding to the box
                bbox.expandByScalar(0.02); 
                
                // Only push ONE box per entire city chunk/floor
                this._cachedStaticBoxes.push({ box: bbox, object: obj });
            }
            console.log("Optimized: Cached " + this._cachedStaticBoxes.length + " merged static physics boxes.");
        }
        filteredTargets.push(...this._cachedStaticTargets);
        physicsBoxes.push(...this._cachedStaticBoxes);

        // 2. PROCESS DYNAMIC COLLIDERS (Cars, Bots)
        for (const obj of dynamicTargets) {
            if (!obj || !obj.position) continue;
            const distSq = obj.position.distanceToSquared(playerPos);
            if (distSq < cullRadiusSq) {
                filteredTargets.push(obj);
                
                // Precompute Bounding Boxes for ultra-fast AABB raycasting in CharacterController
                obj.traverse(child => {
                    if (child.isMesh) {
                        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                        child.updateMatrixWorld(true);
                        const box = new THREE.Box3().copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
                        physicsBoxes.push({ box: box, object: obj }); // Keep reference to root object for pushing logic
                    }
                });
            }
        }

        this.character.allPhysicTargets = filteredTargets;
        this.character.physicsBoxes = physicsBoxes; // Simplified geometries!

        this.weaponManager.remotePlayers = Object.values(this.remotePlayers);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    toggleNightVision() {
        const now = Date.now();
        if (this.lastNVToggle && (now - this.lastNVToggle) < 300) return;
        this.lastNVToggle = now;
        this.isNightVision = !this.isNightVision;
    }

    toggleUI() {
        this.uiVisible = !this.uiVisible;
        const chatInput = document.getElementById('chat-input');
        const chatMessages = document.getElementById('chat-messages');
        if (chatInput) chatInput.style.display = this.uiVisible ? 'block' : 'none';
        if (chatMessages) chatMessages.style.display = this.uiVisible ? 'block' : 'none';

        const idsToToggle = ['dpad-container', 'shapes-container', 'camera-cross-container', 'btn-l', 'btn-r', 'minimap-canvas', 'zone_joystick', 'zone_right'];
        idsToToggle.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = this.uiVisible ? '' : 'none';
        });

        const heliRadar = document.getElementById('heli-radar');
        if (heliRadar) {
            const isHeli = this.character && this.character.isDriving && this.character.vehicle && this.character.vehicle.type === 'helicopter';
            heliRadar.style.display = (this.uiVisible && isHeli) ? '' : 'none';
        }

        if (this.weaponManager) this.weaponManager.toggleUI(this.uiVisible);
    }

    togglePause() {
        console.log("🛠️ togglePause() ejecutado en el cliente.");
        this.isPaused = !this.isPaused;
        this.pausedOverlay.style.display = this.isPaused ? 'flex' : 'none';
        
        if (this.networkManager) {
            console.log("📡 Enviando estado de pausa al servidor:", this.isPaused);
            this.networkManager.sendPause(this.isPaused);
        } else {
            console.warn("⚠️ No hay NetworkManager disponible para enviar la pausa.");
        }
    }

    async toggleAR() {
        if (this.arMode) {
            // Exit AR
            if (this.renderer.xr.getSession()) {
                this.renderer.xr.getSession().end();
            }
            return;
        }

        if (!navigator.xr) {
            alert("Tu dispositivo o navegador no soporta Realidad Aumentada (WebXR).");
            return;
        }

        const sessionInit = { requiredFeatures: ['hit-test'] };
        const session = await navigator.xr.requestSession('immersive-ar', sessionInit);

        this.arMode = true;
        this.renderer.xr.setReferenceSpaceType('local');
        this.renderer.xr.setSession(session);

        // Hide UI for AR
        this.toggleUI();

        // Show Reticle
        this.arReticle.visible = true;

        session.addEventListener('end', () => {
            this.arMode = false;
            this.arHitTestSourceRequested = false;
            this.arHitTestSource = null;
            this.arReticle.visible = false;

            // Restore Scene
            this.scene.scale.set(1, 1, 1);
            this.scene.position.set(0, 0, 0);

            this.uiVisible = false;
            this.toggleUI(); // Restore UI
            console.log("AR Session Ended");
        });

        console.log("AR Session Started");
    }

    animate() {
        try {
            requestAnimationFrame(() => this.animate());
            const dt = Math.min(this.clock.getDelta(), 0.1);
            const time = Date.now() / 1000;

            // Day/Night cycle speed: 1h Day + 30min Night = 90 min total (5400 seconds)
            const dayDuration = 5400; 
            // We use a slight offset in the sine calculation to make the day longer than the night
            // A standard circle is 50/50. To get 66% day (1h) and 33% night (0.5h), we shift the horizon.
            const sunAngle = (time * (2 * Math.PI / dayDuration)) % (2 * Math.PI);
            const sunRadius = 300;
            
            // X and Y positions of the sun
            const sunX = Math.cos(sunAngle) * sunRadius;
            // Shift the sun "up" slightly so it stays above Y=0 for 1 hour and below for 30 mins
            const sunY = (Math.sin(sunAngle) * sunRadius) + 150; 
            const sunZ = 50;

            const isDay = sunY > 0;
            const sunIntensity = isDay ? Math.min(1.5, sunY / 50) : 0.0;

            const dirLight = this.scene.children.find(c => c.isDirectionalLight);
            if (dirLight) {
                if (this.character && this.character.mesh) {
                    dirLight.position.copy(this.character.mesh.position).add(new THREE.Vector3(sunX, Math.max(20, sunY), sunZ));
                    dirLight.target = this.character.mesh;
                } else {
                    dirLight.position.set(sunX, Math.max(20, sunY), sunZ);
                }
                dirLight.intensity = sunIntensity;
                dirLight.castShadow = isDay && !this.isNightVision; // Only shadow during day and when NV is off
            }

            let skyHex = 0x141a24; // Atmospheric cold night
            let groundHex = 0x222a34;
            let fogDist = 70; // Thick snow & fog: requires minimap radar navigation!
            let fogColor = new THREE.Color(0x141a24);

            if (this.isNightVision) {
                const isHeli = this.character && this.character.isDriving && this.character.vehicle && this.character.vehicle.type === 'helicopter';
                skyHex = 0x002200;
                groundHex = 0x004400;
                fogDist = isHeli ? 180 : 120;
                fogColor = new THREE.Color(0x00FF00);
            }

            if (this.minimap && this.minimap.isFullMap && this.character) {
                if (this.weaponManager) this.weaponManager.toggleUI(false);
                fogDist = Math.max(1500, this.minimapSpan + 500);
                if (this.camera.far !== fogDist) {
                    this.camera.far = fogDist;
                    this.camera.updateProjectionMatrix();
                }
                const droneHeight = this.minimapSpan * 1.5;
                const targetPos = this.character.mesh.position.clone().add(this.mapPanningOffset);
                this.camera.position.set(targetPos.x, targetPos.y + droneHeight, targetPos.z + 0.1);
                this.camera.lookAt(targetPos);
            } else {
                if (this.uiVisible && this.weaponManager) this.weaponManager.toggleUI(true);
                if (this.camera.far !== 800) {
                    this.camera.far = 800;
                    this.camera.updateProjectionMatrix();
                }
            }

            const currentSky = this.scene.background;
            const skyLerpSpeed = this.isNightVision ? 10.0 : 2.0;
            const safeSkyHex = (typeof skyHex === 'number' && !isNaN(skyHex)) ? skyHex : 0x87CEEB;
            currentSky.lerp(new THREE.Color(safeSkyHex), Math.min(dt * skyLerpSpeed, 1.0));

            if (fogColor) this.scene.fog.color.lerp(fogColor, dt * 10.0);
            else this.scene.fog.color.copy(currentSky);

            const fogLerpSpeed = this.isNightVision ? 10.0 : 5.0;
            this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, fogDist, dt * fogLerpSpeed);

            const hemiLight = this.scene.children.find(c => c.isHemisphereLight);
            if (hemiLight) {
                if (this.isNightVision) {
                    const isHeli = this.character && this.character.isDriving && this.character.vehicle && this.character.vehicle.type === 'helicopter';
                    hemiLight.color.setHex(0x00FF00);
                    hemiLight.groundColor.setHex(0x003300);
                    hemiLight.intensity = isHeli ? 1.0 : 2.0;
                } else {
                    hemiLight.color.lerp(new THREE.Color(skyHex), dt * 0.5);
                    hemiLight.groundColor.lerp(new THREE.Color(groundHex), dt * 0.5);
                    hemiLight.intensity = isDay ? 0.8 : 0.15; // Lower ambient light at night
                }
            }

            // Global Gamepad Check for Pause/Unpause (Button 9 = Start on generic controller)
            const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
            let startPressed = false;
            for (let i = 0; i < gamepads.length; i++) {
                const gp = gamepads[i];
                if (gp && gp.buttons[9] && (gp.buttons[9].pressed || gp.buttons[9].value > 0.1)) {
                    startPressed = true;
                    break;
                }
            }
            if (startPressed) {
                if (!this._globalStartHeld) {
                    this.togglePause();
                    this._globalStartHeld = true;
                }
            } else {
                this._globalStartHeld = false;
            }

            if (this.character && !this.isPaused) {
                this.character.update(dt);
                if (this.autoPilot) this.autoPilot.update(dt);
                if (!this.colliderThrottle) this.colliderThrottle = 0;
                this.colliderThrottle++;
                if (this.colliderThrottle % 60 === 0) {
                    this.updateRemoteColliders();
                }

                // --- AR MODE LOGIC (Diorama) ---
                if (this.arMode) {
                    const session = this.renderer.xr.getSession();
                    if (session) {
                        const frame = this.renderer.xr.getFrame();
                        if (frame) {
                            const referenceSpace = this.renderer.xr.getReferenceSpace();

                            // Initialize Hit Test Source once
                            if (this.arHitTestSourceRequested === false) {
                                session.requestReferenceSpace('viewer').then((viewerSpace) => {
                                    session.requestHitTestSource({ space: viewerSpace }).then((source) => {
                                        this.arHitTestSource = source;
                                    });
                                });
                                this.arHitTestSourceRequested = true;
                            }

                            // Perform Hit Test
                            if (this.arHitTestSource) {
                                const hitTestResults = frame.getHitTestResults(this.arHitTestSource);
                                if (hitTestResults.length > 0) {
                                    const hit = hitTestResults[0];
                                    const pose = hit.getPose(referenceSpace);

                                    // Update Reticle position
                                    this.arReticle.visible = true;
                                    this.arReticle.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);

                                    // Update World Scale and Position (Follow Reticle)
                                    // We scale the whole scene (except camera and reticle) down
                                    // Actually, let's scale the city, character, and other groups
                                    this.scene.scale.set(this.arWorldScale, this.arWorldScale, this.arWorldScale);
                                    this.scene.position.set(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z);

                                    // Ensure reticle is NOT scaled by the scene (parenting issue)
                                    // Since reticle is child of scene, and scene is scaled, reticle is scaled.
                                    // We need the reticle to stay at real world scale 1.0
                                    this.arReticle.scale.set(1 / this.arWorldScale, 1 / this.arWorldScale, 1 / this.arWorldScale);

                                    // Add pulse effect to reticle
                                    const pulse = 1.0 + Math.sin(Date.now() * 0.01) * 0.1;
                                    this.arReticle.scale.multiplyScalar(pulse);
                                } else {
                                    this.arReticle.visible = false;
                                }
                            }
                        }
                    }
                }
            }

            if (this.npcManager && !this.isPaused) this.npcManager.update(dt);
            if (this.botManager && !this.isPaused) this.botManager.update(dt);
            if (this.modularCity && !this.isPaused) this.modularCity.update(dt);
            if (this.snowEffect && !this.isPaused) this.snowEffect.update(dt);
            
            if (this.weaponManager && !this.isPaused) {
                this.weaponManager.remotePlayers = Object.values(this.remotePlayers);
                this.weaponManager.update(dt);
            }

            if (this.vehicleManager && this.character && !this.isPaused) {
                const input = this.character.inputVector || { x: 0, y: 0 };
                this.vehicleManager.update(dt, input);
                if (!this._motoSaveTimer) this._motoSaveTimer = 0;
                this._motoSaveTimer += dt;
                if (this._motoSaveTimer > 2.0) {
                    this._motoSaveTimer = 0;
                    const moto = this.vehicleManager.vehicles.find(v => v.type === 'motorcycle');
                    if (moto && moto.mesh) {
                        localStorage.setItem('motorcyclePosition', JSON.stringify({ x: moto.mesh.position.x, y: moto.mesh.position.y, z: moto.mesh.position.z }));
                    }
                }
            }


            if (this.sniperManager && !this.isPaused) {
                this.sniperManager.update(dt);
            }

            if (this.character && !this.isInspectionMode) this.character.updateCamera(dt);
            else if (this.isInspectionMode && this.orbitControls) this.orbitControls.update();

            if (this.character && this.camera && this.character.desiredFOV) {
                const targetFOV = this.character.desiredFOV;
                const speed = 5.0;
                const t = 1.0 - Math.pow(0.01, dt * speed);
                if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
                    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, t);
                    this.camera.updateProjectionMatrix();
                }
            }

            // --- SYNC VEHICLE VISIBILITY ---
            if (this.vehicleManager && this.character) {
                const drivenTypes = new Set();
                // Check if local player is driving
                if (this.character.isDriving && this.character.vehicle) {
                    drivenTypes.add(this.character.vehicle.type);
                }
                // Check if any remote player is driving
                Object.values(this.remotePlayers).forEach(p => {
                    if (p.currentVehicleType) {
                        drivenTypes.add(p.currentVehicleType);
                    }
                });

                // Sync each local vehicle's visibility
                this.vehicleManager.vehicles.forEach(v => {
                    if (this.character.isDriving && this.character.vehicle === v) {
                        // If local player is driving it, keep it visible (handled by local character controller)
                        // Do not touch
                    } else {
                        // If someone else (or we) are driving this TYPE of vehicle, hide the parked one
                        v.mesh.visible = !drivenTypes.has(v.type);
                    }
                });
            }

            Object.values(this.remotePlayers).forEach(p => p.update(dt, this.camera));

            if (this.character && this.networkManager && !this.isPaused) {
                const now = performance.now();
                if (!this.lastSendTime || now - this.lastSendTime > 50) { // 20 Ticks per second
                    const charWorldPos = new THREE.Vector3();
                    this.character.mesh.getWorldPosition(charWorldPos);

                    // Check if position or rotation actually changed (optimization)
                    if (!this.lastSentPos) this.lastSentPos = new THREE.Vector3();
                    const state = this.character.state;
                    const weaponType = this.weaponManager ? this.weaponManager.currentWeaponType : 'pistol';
                    const isFiring = this.weaponManager ? this.weaponManager.isFiring : false;
                    const vehicleType = this.character.vehicle ? this.character.vehicle.type : null;
                    const yaw = this.character.yaw;
                    const pitch = this.character.pitch || 0;

                    const posDist = this.lastSentPos.distanceToSquared(charWorldPos);
                    const moved = posDist > 0.001;
                    const turned = Math.abs((this.lastSentYaw || 0) - yaw) > 0.01;
                    const changedState = this.lastSentState !== state || this.lastSentWeapon !== weaponType || this.lastSentFiring !== isFiring || this.lastSentVehicle !== vehicleType;

                    if (moved || turned || changedState) {
                        this.networkManager.sendUpdate(
                            charWorldPos,
                            yaw,
                            pitch,
                            state,
                            weaponType,
                            isFiring,
                            vehicleType
                        );
                        
                        this.lastSendTime = now;
                        this.lastSentPos.copy(charWorldPos);
                        this.lastSentYaw = yaw;
                        this.lastSentState = state;
                        this.lastSentWeapon = weaponType;
                        this.lastSentFiring = isFiring;
                        this.lastSentVehicle = vehicleType;
                    }
                }
            }

            // Teleportation
            if (this.character && !this.character.isDriving && this.transporters.length > 0 && !this.isPaused) {
                if (this.teleportCooldown > 0) this.teleportCooldown -= dt;

                this.transporters.forEach((t, i) => {
                    const dist = this.character.mesh.position.distanceTo(t.pos);
                    if (dist < 2) {
                        if (!t.triggered && this.teleportCooldown <= 0) {
                            t.timer += dt;
                            if (t.timer >= 2.0) {
                                let targetIdx;
                                do { targetIdx = Math.floor(Math.random() * this.transporters.length); } while (targetIdx === i);
                                const target = this.transporters[targetIdx];
                                this.character.mesh.position.copy(target.pos).y += 0.5;
                                this.teleportCooldown = 3.0;
                                t.timer = 0;
                                t.triggered = true;
                                target.triggered = true;
                            }
                        }
                    } else {
                        t.timer = 0;
                        t.triggered = false;
                    }
                });
            }

            // CLUTTER PHYSICS (Pushable objects update)
            for (let i = this.clutterObjects.length - 1; i >= 0; i--) {
                const obj = this.clutterObjects[i];
                if (!obj.parent) { this.clutterObjects.splice(i, 1); continue; }
                if (this.isPaused) continue; // Skip physical updates during pause

                const pushVel = obj.userData.pushVelocity;
                if (pushVel && pushVel.length() > 0.01) {
                    const moveDir = pushVel.clone().normalize();
                    const ray = new THREE.Raycaster(obj.position.clone().add(new THREE.Vector3(0, 0.5, 0)), moveDir);
                    ray.far = 1.0;
                    // Check against buildings
                    const hits = ray.intersectObjects(this.character.colliders, true);

                    if (hits.length === 0) {
                        obj.position.add(pushVel.clone().multiplyScalar(dt));
                    } else {
                        pushVel.set(0, 0, 0);
                    }
                    pushVel.multiplyScalar(Math.max(0, 1.0 - dt * 5.0)); // Friction
                }
            }

            // PICKUPS LOGIC
            const pickupTime = performance.now() * 0.002;
            const playerPos = this.character && this.character.mesh ? this.character.mesh.position : null;

            for (let i = this.pickups.length - 1; i >= 0; i--) {
                const p = this.pickups[i];

                // Animation: bob up and down, and spin
                p.mesh.position.y = p.startY + Math.sin(pickupTime + p.timeOffset) * 0.2;
                p.mesh.rotation.y += dt;

                // Collision with player
                if (playerPos && playerPos.distanceTo(p.mesh.position) < 2.0) {
                    // Pick up!
                    if (p.type === 'bazooka' && this.weaponManager) {
                        // Only pick up if we actually need ammo
                        if (this.weaponManager.ammo['bazooka'] < this.weaponManager.maxAmmo['bazooka']) {
                            this.weaponManager.ammo['bazooka'] = this.weaponManager.maxAmmo['bazooka'];
                            this.weaponManager.updateAmmoUI();
                            if (this.soundManager) this.soundManager.playReload();

                            // Remove from scene
                            this.scene.remove(p.mesh);
                            p.mesh.geometry.dispose();
                            p.mesh.material.dispose();
                            this.pickups.splice(i, 1);

                            console.log("🚀 Bazooka Ammo Picked Up!");
                        }
                    }
                }
            }

            // RENDER PASS
            if (this.renderer) {
                if (this.smokingHeliPos && Math.random() > 0.8) {
                    const p = new THREE.Mesh(this._sharedSmokeGeom, this._sharedSmokeMat.clone());
                    p.position.copy(this.smokingHeliPos).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2));
                    p.userData.vel = new THREE.Vector3((Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2);
                    p.userData.life = 0;
                    this.scene.add(p);
                    this.particles.push(p);
                }

                for (let i = this.particles.length - 1; i >= 0; i--) {
                    const p = this.particles[i];
                    p.userData.life += dt;
                    if (p.userData.life > 3.0) {
                        this.scene.remove(p);
                        p.material.dispose();
                        this.particles.splice(i, 1);
                    } else {
                        p.position.add(p.userData.vel.clone().multiplyScalar(dt));
                        p.scale.multiplyScalar(1.0 + dt * 0.5);
                        p.material.opacity = 0.6 * (1 - (p.userData.life / 3.0));
                    }
                }

                if (this.vrMode) {
                    this.stereoEffect.render(this.scene, this.camera);
                } else {
                    this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
                    this.renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
                    this.renderer.setScissorTest(true);
                    this.renderer.render(this.scene, this.camera);

                    const minimapEl = document.getElementById('minimap-canvas');
                    if (this.minimap && !this.minimap.isFullMap && minimapEl && minimapEl.style.display !== 'none') {
                        if (this.minimapCamera && this.character && this.character.mesh) {
                            this.minimapCamera.position.x = this.character.mesh.position.x;
                            this.minimapCamera.position.z = this.character.mesh.position.z;
                            const size = minimapEl.width;
                            const glX = window.innerWidth - size - 10;
                            const glY = window.innerHeight - size - 10;
                            this.renderer.setViewport(glX, glY, size, size);
                            this.renderer.setScissor(glX, glY, size, size);
                            this.renderer.autoClear = false;
                            this.renderer.clearDepth();
                            const tempFog = this.scene.fog;
                            this.scene.fog = null;
                            this.renderer.render(this.scene, this.minimapCamera);
                            this.scene.fog = tempFog;
                            this.renderer.autoClear = true;
                        }
                    }

                    if (!this.minimapThrottle) this.minimapThrottle = 0;
                    this.minimapThrottle++;
                    if (this.minimap && this.character && this.character.mesh && this.minimapThrottle % 10 === 0) {
                        const activeCam = this.minimap.isFullMap ? this.camera : this.minimapCamera;
                        this.minimap.update(this.character, this.remotePlayers, this.npcManager, this.vehicleManager, activeCam, this.botManager);
                    }
                }
            }
        } catch (e) {
            console.error("Main Loop Error:", e);
        }
    }

    toggleVR() {
        this.vrMode = !this.vrMode;
        if (this.vrMode) this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
    }

    triggerShake(intensity = 0.5) {
        if (!this.camera) return;
        const startTime = Date.now();
        const duration = 500;
        const anim = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > duration) return;
            const progress = 1 - (elapsed / duration);
            const currentIntensity = intensity * progress;
            this.camera.position.x += (Math.random() - 0.5) * currentIntensity;
            this.camera.position.y += (Math.random() - 0.5) * currentIntensity;
            this.camera.position.z += (Math.random() - 0.5) * currentIntensity;
            requestAnimationFrame(anim);
        };
        anim();
    }

    triggerDamageFlash() {
        const flash = document.createElement('div');
        flash.style.position = 'fixed';
        flash.style.top = '0';
        flash.style.left = '0';
        flash.style.width = '100vw';
        flash.style.height = '100vh';
        flash.style.backgroundColor = 'rgba(255, 0, 0, 0.5)'; // More visible
        flash.style.pointerEvents = 'none';
        flash.style.zIndex = '1000000'; // Maximum priority
        document.body.appendChild(flash);

        setTimeout(() => {
            flash.style.transition = 'opacity 0.15s ease-out';
            flash.style.opacity = '0';
            setTimeout(() => {
                if (flash.parentNode) document.body.removeChild(flash);
            }, 200);
        }, 100);
    }

    createDepartureHeliBase() {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#1c222a';
        ctx.fillRect(0, 0, 256, 256);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(128, 128, 105, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '900 120px "Arial Black", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', 128, 128);

        const tex = new THREE.CanvasTexture(c);
        const pad = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(12, 0.05, 12);
        this.scene.add(pad);

        // 4 Green Corner Lights for Takeoff Pad
        const offsets = [-7, 7];
        offsets.forEach(dx => {
            offsets.forEach(dz => {
                const lightCore = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0x00ff88 }));
                lightCore.position.set(12 + dx, 0.4, 12 + dz);
                this.scene.add(lightCore);
            });
        });

        // Show brief mission banner on start
        const existingBanner = document.getElementById('air-mission-banner');
        if (existingBanner) existingBanner.remove();

        const banner = document.createElement('div');
        banner.id = 'air-mission-banner';
        banner.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            background: rgba(12, 20, 30, 0.92); border: 2px solid #00ffaa;
            border-radius: 8px; padding: 12px 22px; color: #ffffff;
            font-family: monospace; font-size: 13px; font-weight: bold;
            box-shadow: 0 0 25px rgba(0, 255, 170, 0.45); text-align: center;
            z-index: 100000; pointer-events: none; transition: opacity 1.2s ease;
        `;
        banner.innerHTML = `🚁 ALERTA: SECTOR CERO OCULTO EN LA NIEVE Y NIEBLA<br><span style="color:#00ffaa; font-size:11px;">ACCESO SOLO POR EL AIRE // SIGUE LA BALIZA VERDE EN EL MAPA</span>`;
        document.body.appendChild(banner);
        setTimeout(() => {
            banner.style.opacity = '0';
            setTimeout(() => banner.remove(), 1200);
        }, 8500);
    }

    onWindowResize() {
        if (!this.camera || !this.renderer) return;
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();

        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth <= 800;
        const targetMaxHeight = isMobile ? 720 : 1080;
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(1.0, targetMaxHeight / (window.innerHeight * dpr));
        const finalPixelRatio = Math.max(0.65, Math.min(1.0, dpr * scale));

        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(finalPixelRatio);

        if (this.vrMode && this.stereoEffect) {
            this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
        }
    }
}
