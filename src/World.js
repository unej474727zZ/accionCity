console.log('World.js loaded');
import * as THREE from 'three';
import { VehicleManager } from './VehicleManager.js';
import { AssetLoader } from './AssetLoader.js';
import { CharacterController } from './CharacterController.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { StereoEffect } from 'three/examples/jsm/effects/StereoEffect.js';
import { NPCManager } from './NPCManager.js';

import { NetworkManager } from './NetworkManager.js';
import { RemotePlayer } from './RemotePlayer.js';
import { WeaponManager } from './WeaponManager.js';
import { Minimap } from './Minimap.js';
import { SoundManager } from './SoundManager.js';

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
})();

export class World {
    constructor(container) {
        this.container = container;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250); // FAR PLANE REDUCED FOR MOBILE VRAM
        this.scene.userData.world = this; // Global access for components

        // NETWORKING
        this.networkManager = new NetworkManager();
        this.remotePlayers = {}; // Map id -> Mesh
        this.soundManager = new SoundManager(this.camera); // Initialize centralized manager

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

        // Environment: Sky & Fog
        const skyColor = 0x87CEEB; // Sky Blue
        const groundColor = 0x555555; // Grayish
        this.scene.background = new THREE.Color(skyColor);

        // FOG: Hides the edge of the world (Depth)
        // Denser fog for "heavy atmosphere" as requested
        // near: 20 (starts close), far: 150 (obscures distant buildings)
        this.scene.fog = new THREE.Fog(skyColor, 20, 150);

        // Lighting
        // Hemisphere: Sky Color + Ground Bounce
        const hemiLight = new THREE.HemisphereLight(skyColor, groundColor, 0.6);
        this.scene.add(hemiLight);

        // Directional (Sun)
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(50, 100, 50); // High sun
        dirLight.castShadow = false; // SHADOWS DISABLED FOR MOBILE PERFORMANCE
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
        this._sharedSmokeGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
        this._sharedSmokeMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.6 });
        this.particles = []; 

        // AR RETICLE (Ring to show where the city will be placed)
        this.arReticle = new THREE.Mesh(
            new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.8 })
        );
        this.arReticle.visible = false;
        this.scene.add(this.arReticle);
    }

    async start() {
        document.getElementById('loading').style.display = 'block';

        try {
            const assets = await this.assetLoader.loadAll();

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
                new THREE.MeshBasicMaterial({ map: asphaltTexture })
            );
            floor.name = "AsphaltFloor";
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = 0.01;
            this.scene.add(floor);

            // TELEPORTATION PADS
            this.transporters = [];
            const transporterPositions = [
                new THREE.Vector3(430, 0, 430),
                new THREE.Vector3(-430, 0, 430),
                new THREE.Vector3(430, 0, -430),
                new THREE.Vector3(-430, 0, -430)
            ];

            const carKeys = ['car1', 'car2', 'car3', 'car1', 'car2', 'car3', 'tank']; // Tanks are now 1 in 7 probability
            const tNames = ['transporter', 'transporter1', 'transporter2', 'transporter3'];
            tNames.forEach((name, i) => {
                const asset = assets[name];
                if (asset) {
                    const pad = asset.scene.clone();
                    pad.position.copy(transporterPositions[i]);
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
                }
            });

            this.teleportCooldown = 0;

            // Setup Character
            this.character = new CharacterController(this.scene, this.camera, assets, this);

            // Register transporters as colliders so they are solid
            this.transporters.forEach(t => {
                t.mesh.traverse(child => {
                    if (child.isMesh) this.character.colliders.push(child);
                });
            });

            // ADD CITY TO COLLISIONS! (Optimized)
            this.cityBlocks = [];
            if (city) {
                this._cityMeshCount = 0;
                city.traverse((child) => {
                    if (child.isMesh) {
                        if (this._cityMeshCount < 800) {
                            this.character.colliders.push(child);
                            this._cityMeshCount++;
                        }
                        
                        // Extract bounds for minimap
                        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                        child.updateMatrixWorld(true);
                        const bbox = new THREE.Box3().setFromObject(child);
                        this.cityBlocks.push({
                            minX: bbox.min.x, maxX: bbox.max.x,
                            minZ: bbox.min.z, maxZ: bbox.max.z
                        });
                    }
                });
                console.log(`Registered ${this._cityMeshCount} city colliders (Optimized).`);
            }

            // LOAD CHARACTER POSITION
            // RESCUE PROTOCOL: Force a fresh safe spawn once to get out of buildings
            localStorage.removeItem('characterPosition'); 
            console.log("World: System Ready. Forced Reset for Rescue.");

            this.camera.lookAt(this.character.mesh.position);

            // AUDIO LISTENER (Ear)
            this.audioListener = new THREE.AudioListener();
            this.camera.add(this.audioListener);

            // Unlock AudioContext on mobile (browsers block audio until interaction)
            const unlockAudio = () => {
                if (this.audioListener.context.state === 'suspended') {
                    this.audioListener.context.resume();
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
            // Reduced density: from 80 to 30 for performance recovery
            this.npcManager.initParkedCars(30);

            // WEAPON MANAGER (EMOTION!!!)
            this.weaponManager = new WeaponManager(this.scene, this.character, this.camera, assets);

            // LINK CONTROLLER TO WEAPON MANAGER
            this.character.weaponManager = this.weaponManager;

            // MINIMAP
            this.minimap = new Minimap(this.cityBlocks, this.camera);

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
            if (city) this.spawnTargets.push(city);
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

            // --- WAR ZONE ENVIRONMENT SATURATION ---
            const addScenery = (name, pos, rot = new THREE.Euler(), scale = 1.0, isExplosive = false) => {
                const asset = assets[name];
                if (!asset) return null;
                const mesh = asset.scene.clone();
                mesh.position.copy(pos);
                mesh.rotation.copy(rot);
                mesh.scale.set(scale, scale, scale);
                
                // --- CRITICAL FIX: MAKE OBJECTS SOLID ---
                this.scene.add(mesh);
                this.character.colliders.push(mesh); // No more passing through!
                this.spawnTargets.push(mesh);

                if (isExplosive) {
                    mesh.userData.isExplosive = true;
                    mesh.userData.hp = 1;
                    const canisterData = { mesh, exploded: false };
                    this.explosiveCanisters.push(canisterData);
                    if (this.weaponManager) {
                        this.weaponManager.canisters.push(canisterData);
                    }

                    // FORCE RED COLOR (Bombonas Rojas)
                    if (name === 'canister') {
                        mesh.traverse(child => {
                            if (child.isMesh) {
                                child.material = child.material.clone();
                                child.material.color.setHex(0xff0000);
                                if (child.material.emissive) child.material.emissive.setHex(0x440000);
                            }
                        });
                    }
                }
                return mesh;
            };

            // 1. Trash Cans (Solid and Pushable, NOT Explosive)
            for (let i = 0; i < 60; i++) {
                const x = (Math.random() - 0.5) * 450;
                const z = (Math.random() - 0.5) * 450;
                const mesh = addScenery('trash_can', new THREE.Vector3(x, 0, z), new THREE.Euler(0, Math.random() * Math.PI, 0), 0.6, false);
                if (mesh) {
                    mesh.userData.isTrashCan = true;
                    mesh.userData.hp = 5; // 5 shots with pistol
                }
            }

            // 2. Dumpsters Snapped to Walls (19.95 offset for Parkour)
            for (let x = -5; x <= 5; x++) {
                for (let z = -5; z <= 5; z++) {
                    if (Math.random() > 0.3) {
                        const side = Math.random() > 0.5 ? 1 : -1;
                        const axis = Math.random() > 0.5 ? 'x' : 'z';
                        const pos = new THREE.Vector3(x * 40, 0, z * 40);
                        let rot = 0;
                        if (axis === 'x') { pos.x += 19.98 * side; rot = (side > 0) ? 1.57 : -1.57; }
                        else { pos.z += 19.98 * side; rot = (side > 0) ? 0 : 3.14; }
                        addScenery(Math.random() > 0.5 ? 'dumpster1' : 'dumpster2', pos, new THREE.Euler(0, rot, 0), 0.8);
                    }
                }
            }

            // 3. Wrecks (Solid)
            for (let i = 0; i < 25; i++) {
                const pos = new THREE.Vector3((Math.random() - 0.5) * 450, 0, (Math.random() - 0.5) * 450);
                addScenery('tank_wreck', pos, new THREE.Euler(0, Math.random() * Math.PI, 0), 0.05);
                addScenery('car_wreck_fsc', pos.clone().add(new THREE.Vector3(5, 0, 5)), new THREE.Euler(0, Math.random() * Math.PI, 0), 0.1);
            }

            // 4. Explosive Canisters (Bombonas Rojas)
            for (let i = 0; i < 80; i++) {
                const x = (Math.random() - 0.5) * 440;
                const z = (Math.random() - 0.5) * 440;
                addScenery('canister', new THREE.Vector3(x, 0.4, z), new THREE.Euler(0, 0, 0), 0.6, true);
            }

            // PASS COLLIDERS
            if (city) this.character.colliders.push(city);
            if (floor) this.character.colliders.push(floor);

            // NETWORK: Connect and Setup Events
            this.networkManager.connect();

            this.networkManager.onPlayerJoined = (id, data) => {
                console.log("Player Joined:", id);
                if (this.remotePlayers[id]) return; // Already exists
                const remotePlayer = new RemotePlayer(this.scene, assets, id, data);
                this.remotePlayers[id] = remotePlayer;
                this.updateRemoteColliders(); // Sync with key systems
            };

            this.networkManager.onPlayerMoved = (id, data) => {
                const remotePlayer = this.remotePlayers[id];
                if (remotePlayer) remotePlayer.updateState(data);
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

            // CHAT SYSTEM
            const chatInput = document.getElementById('chat-input');
            const chatMessages = document.getElementById('chat-messages');

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
                    remotePlayer.shoot(data.origin, data.direction, data.weaponType);
                }
            };

            this.networkManager.onPlayerHit = (data) => {
                if (this.weaponManager) {
                    this.weaponManager.createImpact(data.position, null, data.type, data.scale || 1.0);
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

            // --- FINAL SPAWN (Safe Street Center) ---
            const finalSpawn = new THREE.Vector3(0, 0.5, 0); 
            this.character.mesh.position.copy(finalSpawn);
            
            this.vehicleManager.spawnVehicle('motorcycle', new THREE.Vector3(10, 0.5, 10));
            this.vehicleManager.spawnVehicle('tank', new THREE.Vector3(450, 0.5, 450)); // Further out
            this.vehicleManager.spawnVehicle('helicopter', new THREE.Vector3(450, 0.5, -450)); // Further out

            // Set camera to player
            this.camera.position.copy(finalSpawn).add(new THREE.Vector3(0, 5, 10)); 
            this.camera.lookAt(finalSpawn);

            // CRITICAL: HIDE LOADING SCREEN
            const loadingScreen = document.getElementById('loading');
            if (loadingScreen) loadingScreen.style.display = 'none';

            this.animate();

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
        
        this.character.remoteColliders = dynamicColliders;
        
        // CONSOLIDATED COLLIDER LIST for Character Physics (Performance!)
        // Instead of concatenating every frame, we do it here once a second
        this.character.allPhysicTargets = [...this.character.colliders, ...dynamicColliders];
        
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

        const idsToToggle = ['dpad-container', 'shapes-container', 'camera-cross-container', 'btn-l', 'btn-r', 'minimap-canvas'];
        idsToToggle.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = this.uiVisible ? '' : 'none';
        });

        if (this.weaponManager) this.weaponManager.toggleUI(this.uiVisible);
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

            const sunAngle = Math.PI / 2; // Fixed at Noon
            const sunRadius = 200;
            let sunIntensity = 1.5;

            const dirLight = this.scene.children.find(c => c.isDirectionalLight);
            if (dirLight) {
                dirLight.position.set(0, sunRadius, 50);
                dirLight.intensity = sunIntensity;
                dirLight.castShadow = false; // CRITICAL: Disabled for performance
            }

            let skyHex = 0x87CEEB;
            let groundHex = 0x555555;
            let fogDist = 250; // Optimized from 1500
            let fogColor = null;

            if (this.isNightVision) {
                skyHex = 0x002200;
                groundHex = 0x004400;
                fogDist = 200;
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
                if (this.camera.far !== 250) {
                    this.camera.far = 250;
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
                    hemiLight.color.setHex(0x00FF00);
                    hemiLight.groundColor.setHex(0x003300);
                    hemiLight.intensity = 2.0;
                } else {
                    hemiLight.color.lerp(new THREE.Color(skyHex), dt * 0.5);
                    hemiLight.groundColor.lerp(new THREE.Color(groundHex), dt * 0.5);
                    hemiLight.intensity = 0.8;
                }
            }

            if (this.character) {
                this.character.update(dt);
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
                                    this.arReticle.scale.set(1/this.arWorldScale, 1/this.arWorldScale, 1/this.arWorldScale);
                                    
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

            if (this.npcManager) this.npcManager.update(dt);
            if (this.weaponManager) {
                this.weaponManager.remotePlayers = Object.values(this.remotePlayers);
                this.weaponManager.update(dt);
            }

            if (this.vehicleManager && this.character) {
                const input = this.character.inputVector || { x: 0, y: 0 };
                this.vehicleManager.update(dt, input);
                const moto = this.vehicleManager.vehicles.find(v => v.type === 'motorcycle');
                if (moto && moto.mesh) {
                    localStorage.setItem('motorcyclePosition', JSON.stringify({ x: moto.mesh.position.x, y: moto.mesh.position.y, z: moto.mesh.position.z }));
                }
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

            Object.values(this.remotePlayers).forEach(p => p.update(dt, this.camera));

            if (this.character && this.networkManager) {
                this.networkManager.sendUpdate(this.character.mesh.position, this.character.yaw, this.character.state, this.weaponManager ? this.weaponManager.currentWeaponType : 'pistol');
                localStorage.setItem('characterPosition', JSON.stringify({ x: this.character.mesh.position.x, y: this.character.mesh.position.y, z: this.character.mesh.position.z }));
            }

            // Teleportation
            if (this.character && !this.character.isDriving && this.transporters.length > 0) {
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
                            const size = 200;
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
                        this.minimap.update(this.character, this.remotePlayers, this.npcManager, this.vehicleManager, activeCam);
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
}
