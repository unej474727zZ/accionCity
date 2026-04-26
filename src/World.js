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

        // MAP PANNING STATE
        this.mapPanningOffset = new THREE.Vector3(0, 0, 0);
        this.isDraggingMap = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;

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
            floor.position.y = 0.05;
            this.scene.add(floor);

            // TELEPORTATION PADS
            this.transporters = [];
            const transporterPositions = [
                new THREE.Vector3(150, 0, 150),
                new THREE.Vector3(-150, 0, 150),
                new THREE.Vector3(150, 0, -150),
                new THREE.Vector3(-150, 0, -150)
            ];

            const tNames = ['transporter', 'transporter1', 'transporter2', 'transporter3'];
            tNames.forEach((name, i) => {
                const asset = assets[name];
                if (asset) {
                    const pad = asset.scene.clone();
                    pad.position.copy(transporterPositions[i]);
                    // Auto-align to ground? For now just place at 0.06 (above floor)
                    pad.position.y = 0.06;
                    this.scene.add(pad);
                    this.transporters.push({
                        mesh: pad,
                        pos: pad.position.clone(),
                        timer: 0
                    });
                    console.log(`Transporter ${i} placed at ${pad.position.x}, ${pad.position.z}`);
                }
            });

            this.teleportCooldown = 0;

            // DEBUG: Add on-screen console for mobile
            // DEBUG: Console removed


            // Setup Character
            this.character = new CharacterController(this.scene, this.camera, assets, this);

            // ADD CITY TO COLLISIONS!
            this.cityBlocks = [];
            if (city) {
                city.traverse((child) => {
                    if (child.isMesh) {
                        this.character.colliders.push(child);

                        // Extract bounds for dynamic 2D Hacker Map
                        if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
                        child.updateMatrixWorld(true);
                        const bbox = new THREE.Box3().setFromObject(child);
                        this.cityBlocks.push({
                            minX: bbox.min.x,
                            maxX: bbox.max.x,
                            minZ: bbox.min.z,
                            maxZ: bbox.max.z
                        });
                    }
                });
                console.log(`Registered city meshes to player colliders and extracted ${this.cityBlocks.length} map blocks!`);
            }

            // LOAD CHARACTER POSITION
            // RESCUE PROTOCOL: User is stuck in a wall! Wipe the save so they spawn at origin.
            localStorage.removeItem('characterPosition');
            localStorage.removeItem('playerPos');
            localStorage.removeItem('motorcyclePosition');
            console.log("Rescued character. All Saves wiped.");

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
            // NPC MANAGER
            this.npcManager = new NPCManager(this.scene, assets);
            // Parked Cars (Static) per user request
            this.npcManager.initParkedCars(50);

            // WEAPON MANAGER (EMOTION!!!)
            // Pass character.mesh (for bones) AND character controller (for animations)
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

            // Spawn Motorcycle at a safe fixed spot if everything else fails
            let spawnPos = new THREE.Vector3(-300, 0.5, -40);
            this.vehicleManager.spawnVehicle('motorcycle', spawnPos);

            // ARMAGE DON TANK SPAWN: Safer outskirts (-300) to avoid falling off map
            let tankPos = new THREE.Vector3(-300, 0.5, 0);
            this.vehicleManager.spawnVehicle('tank', tankPos);

            // HELICOPTER SPAWN: 20m to the right of the tank
            let heliPos = new THREE.Vector3(-300, 0.5, -20);
            this.vehicleManager.spawnVehicle('helicopter', heliPos);

            // Start with Pistol equipped? Or wait for input? Let's equip Pistol by default.
            // But we need to make sure model is ready. Construct it now, call equip later or inside.

            // PASS COLLIDERS
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
                this.updateRemoteColliders(); // Sync with key systems
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
            statusEl.style.display = 'none'; // Hide status text for cleaner app UI
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
                console.log("Chat received:", data); // Debug
                const msg = document.createElement('div');
                msg.className = 'chat-msg';
                msg.style.color = data.color || 'white';
                msg.innerHTML = `<strong>${data.name}:</strong> ${data.text}`;
                chatMessages.appendChild(msg);
                chatMessages.scrollTop = chatMessages.scrollHeight;
            };

            // COMBAT EVENTS
            this.networkManager.onPlayerShoot = (data) => {
                // data: { id, origin, direction, weaponType }
                if (data.id === this.networkManager.id) return;
                console.log(`[NET] Received playerShoot from ${data.id}`, data);

                const remotePlayer = this.remotePlayers[data.id];
                if (remotePlayer) {
                    console.log(`[COMBAT] Commanding RemotePlayer ${data.id} to shoot`);
                    remotePlayer.shoot(data.origin, data.direction, data.weaponType);
                } else {
                    console.warn(`[COMBAT] RemotePlayer ${data.id} NOT FOUND for shoot event`);
                }
            };

            this.networkManager.onPlayerHit = (data) => {
                // data: { id, position, type }
                console.log(`[NET] Global Hit Received:`, data);
                if (this.weaponManager) {
                    this.weaponManager.createImpact(data.position, data.type);
                }
            };

            if (chatInput) {
                chatInput.addEventListener('keydown', (e) => {
                    e.stopPropagation(); // Keep reacting to keys but don't propagate to game
                });

                chatInput.addEventListener('keyup', (e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        const text = chatInput.value.trim();
                        if (text) {
                            console.log("Sending chat:", text); // Debug
                            this.networkManager.sendChat(text);
                            chatInput.value = '';
                            chatInput.blur(); // CRITICAL: Release focus so player can move again
                        }
                    }
                });

                // Also prevent clicks on input from moving camera?
                // (Already handled by pointer-events auto vs none in CSS, usually)
            }

            document.getElementById('loading').style.display = 'none';

            // UI Toggle State
            this.uiVisible = true;
            window.addEventListener('keydown', (e) => {
                if (e.code === 'KeyP') {
                    this.toggleUI();
                }

                // Vehicle interaction is handled by 'Space' in CharacterController.

                // INSPECTION MODE (I)
                if (e.code === 'KeyI') {
                    this.isInspectionMode = !this.isInspectionMode;
                    this.orbitControls.enabled = this.isInspectionMode;

                    if (this.isInspectionMode) {
                        console.log("🔍 Inspection Mode: ON. Use Mouse to Rotate/Pan.");
                        document.exitPointerLock();

                        // FIX: Auto-Focus on Character/Vehicle
                        const targetObj = this.character.mesh;
                        if (targetObj) {
                            // Target slightly above the pivot (which is at feet)
                            const targetPos = targetObj.position.clone().add(new THREE.Vector3(0, 0.5, 0));
                            this.orbitControls.target.copy(targetPos);

                            // Optional: Move camera if it's too far/close? 
                            // Letting OrbitControls handle current position is usually smoother unless broken.
                            this.orbitControls.update();
                        }
                    } else {
                        console.log("▶️ Game Mode: ON");
                        // Attempt to re-lock mouse for game controls
                        document.body.requestPointerLock();
                    }
                }
                if (e.code === 'KeyM') {
                    if (this.minimap) {
                        this.minimap.toggleUI();
                        // Resetear el desplazamiento al cerrar el mapa
                        if (!this.minimap.isFullMap) {
                            this.mapPanningOffset.set(0, 0, 0);
                        }
                        // Liberar el ratón si el mapa está en pantalla completa
                        if (this.minimap.isFullMap) {
                            document.exitPointerLock();
                        } else {
                            document.body.requestPointerLock();
                        }
                    }
                }

                if (e.code === 'Equal' || e.code === 'NumpadAdd') {
                    this.updateMinimap3DZoom(0.2);
                }
                if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
                    this.updateMinimap3DZoom(-0.2);
                }
            });

            // MOUSE DRAGGING FOR MAP PANNING (Robust version)
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

                    const sens = this.minimapSpan / 400; // Ajustada para ser más suave
                    this.mapPanningOffset.x -= dx * sens;
                    this.mapPanningOffset.z -= dy * sens;

                    this.lastMouseX = e.clientX;
                    this.lastMouseY = e.clientY;

                    // Prevenir que otros elementos atrapen el ratón
                    e.preventDefault();
                }
            };

            const handleMouseUp = () => {
                this.isDraggingMap = false;
            };

            document.addEventListener('mousedown', handleMouseDown);
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            window.addEventListener('blur', handleMouseUp); // Por si se pierde el foco

            window.addEventListener('wheel', (e) => {
                if (!this.minimap) return;

                const delta = e.deltaY > 0 ? -0.5 : 0.5; // Zoom más fuerte

                if (this.minimap.isFullMap) {
                    // Zoom real cambiando la altura del drone (minimapSpan)
                    this.updateMinimap3DZoom(delta);
                } else {
                    // Zoom de la cámara en modo tercera persona
                    if (this.character) {
                        const minFOV = (this.character.isDriving && this.character.vehicle && this.character.vehicle.type === 'helicopter') ? 5 : 10;
                        this.character.desiredFOV = THREE.MathUtils.clamp(this.character.desiredFOV - (delta * 50), minFOV, 75);
                        if (document.pointerLockElement || this.character.isDriving) {
                            this.character.cameraDistance = THREE.MathUtils.clamp(this.character.cameraDistance - (delta * 10), 0.1, 15.0);
                        }
                    }
                }
            }, { passive: true });

            this.animate();
        } catch (err) {
            console.error('Failed to load game:', err);
            document.getElementById('loading').innerText = 'Error loading assets.';
        }
    }


    // Helper: Update 3D Minimap Zoom
    updateMinimap3DZoom(delta) {
        if (!this.minimapCamera) return;
        // Adjust span based on delta. Zoom IN (delta > 0) means SMALLER span.
        // We now use this span to determine DRONE HEIGHT as well.
        this.minimapSpan = THREE.MathUtils.clamp(this.minimapSpan - delta * 40, 40, 400);
        this.minimapCamera.left = -this.minimapSpan;
        this.minimapCamera.right = this.minimapSpan;
        this.minimapCamera.top = this.minimapSpan;
        this.minimapCamera.bottom = -this.minimapSpan;
        this.minimapCamera.updateProjectionMatrix();
    }

    // Helper: Sync Remote Player Meshes to Controllers
    updateRemoteColliders() {
        if (!this.character || !this.weaponManager) return;

        const players = Object.values(this.remotePlayers);
        // For physics (CharacterController), we need Meshes
        const meshes = players.map(p => p.mesh).filter(m => m);

        // Update Character Controller (Physics Collision)
        if (this.character) this.character.remoteColliders = meshes;

        // Update Weapon Manager (Bullet Hits)
        if (this.weaponManager) this.weaponManager.remotePlayers = players;
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    toggleNightVision() {
        const now = Date.now();
        if (this.lastNVToggle && (now - this.lastNVToggle) < 300) {
            return; // Debounce: Prevent double-tap within 300ms
        }
        this.lastNVToggle = now;

        this.isNightVision = !this.isNightVision;
        console.log("Night Vision Toggle:", this.isNightVision);
    }

    toggleUI() {
        this.uiVisible = !this.uiVisible;
        const display = this.uiVisible ? 'block' : 'none';
        const displayFlex = this.uiVisible ? 'flex' : 'none';

        // 1. Chat
        const chatInput = document.getElementById('chat-input');
        const chatMessages = document.getElementById('chat-messages');
        if (chatInput) chatInput.style.display = display;
        if (chatMessages) chatMessages.style.display = display;

        // 2. Mobile PSP Controls (Game parts only)
        // We keep #center-bar (Start/Select) and #toggles-container visible so we can toggle back!
        const idsToToggle = [
            'dpad-container',
            'shapes-container',
            'camera-cross-container',
            'btn-l',
            'btn-r',
            'minimap-canvas' // Also hide map canvas
        ];

        idsToToggle.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // Check if it was flex or block? Most are absolute/block.
                // Except shoulder buttons which are flex.
                // Safest to toggle visibility or display based on original?
                // For simplicity, display='none' vs ... empty string?
                // Or just use the 'display' var which is 'block'/'none'.
                // Shoulder btns and others are okay with block or flex?
                // .psp-btn is flex.
                el.style.display = this.uiVisible ? '' : 'none'; // '' reverts to CSS default
            }
        });

        // 3. Status
        // ...

        // 4. Weapon UI
        if (this.weaponManager) this.weaponManager.toggleUI(this.uiVisible);

        // 5. Minimap Container
        // if (this.minimap) this.minimap.toggleUI(this.uiVisible); // Handled by ID above

        console.log("UI Visibility:", this.uiVisible);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const dt = Math.min(this.clock.getDelta(), 0.1);
        const time = Date.now() / 1000;

        // --- DAY/NIGHT CYCLE (FROZEN FOR VISUAL TESTS) ---
        // Forced Noon: Sun at its peak for perfect visibility.
        const sunAngle = Math.PI / 2; // Fixed at 90 degrees (High Noon)

        const sunRadius = 200;
        let sunIntensity = 1.5; // Max intensity

        // Find the directional light
        const dirLight = this.scene.children.find(c => c.isDirectionalLight);
        if (dirLight) {
            dirLight.position.x = 0; // Directly above
            dirLight.position.y = sunRadius;
            dirLight.position.z = 50;

            // Stable light for picnic day
            const cloudFactor = 1.0;

            dirLight.mask = 1;
            dirLight.intensity = sunIntensity * cloudFactor;
            dirLight.castShadow = true;
        }

        // Sky Color Interpolation
        let skyHex = 0x000000;
        let groundHex = 0x111111;
        let fogDist = 1500;
        let fogColor = null;

        const dayIntensity = Math.max(0, Math.sin(sunAngle));

        if (dayIntensity > 0.8) {
            skyHex = 0x87CEEB; // Blue
            groundHex = 0x555555;
        } else if (dayIntensity > 0.2) {
            skyHex = 0xFF4500; // Orange
            groundHex = 0x332222;
            fogDist = 800;
        } else {
            skyHex = 0x050510; // Night
            groundHex = 0x000000;
            fogDist = 500;
        }

        // --- NIGHT VISION OVERRIDE ---
        if (this.isNightVision) {
            skyHex = 0x002200; // Dark Green
            groundHex = 0x004400; // Brighter Green Floor
            fogDist = 200; // See further in dark
            fogColor = new THREE.Color(0x00FF00); // Bright Green Fog
        }

        // --- DRONE MAP FOG & CAMERA OVERRIDE ---
        if (this.minimap && this.minimap.isFullMap && this.character) {
            // 1. Hide Game UI
            if (this.weaponManager) this.weaponManager.toggleUI(false);

            // 2. Push fog way back based on drone span so ground is always visible
            fogDist = Math.max(1500, this.minimapSpan + 500);
            if (this.camera.far !== fogDist) {
                this.camera.far = fogDist;
                this.camera.updateProjectionMatrix();
            }

            // 3. DRONE POSITION: High above player looking down
            // height is derived from current zoom (minimapSpan)
            const droneHeight = this.minimapSpan * 1.5;
            const targetPos = this.character.mesh.position.clone().add(this.mapPanningOffset);
            this.camera.position.set(targetPos.x, targetPos.y + droneHeight, targetPos.z + 0.1);
            this.camera.lookAt(targetPos);
        } else {
            // Restore Game UI if general UI is visible
            if (this.uiVisible && this.weaponManager) this.weaponManager.toggleUI(true);

            if (this.camera.far !== 250) {
                this.camera.far = 250;
                this.camera.updateProjectionMatrix();
            }
        }

        // Smoothly lerp current color to target
        const currentSky = this.scene.background;
        // Faster lerp for responsiveness (dt * 2.0 instead of 0.5)
        // If Night Vision is active, snap sky faster (dt * 10.0)
        const skyLerpSpeed = this.isNightVision ? 10.0 : 2.0;

        // Safety check to avoid magenta/invalid colors
        const safeSkyHex = (typeof skyHex === 'number' && !isNaN(skyHex)) ? skyHex : 0x000000;
        currentSky.lerp(new THREE.Color(safeSkyHex), Math.min(dt * skyLerpSpeed, 1.0));

        // Update Fog
        if (fogColor) {
            // Very fast transition for Night Vision
            this.scene.fog.color.lerp(fogColor, dt * 10.0);
        } else {
            this.scene.fog.color.copy(currentSky);
        }

        const fogLerpSpeed = this.isNightVision ? 10.0 : 5.0;
        this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, fogDist, dt * fogLerpSpeed);

        // Update Ambient/Hemi Light
        const hemiLight = this.scene.children.find(c => c.isHemisphereLight);
        if (hemiLight) {
            if (this.isNightVision) {
                // NV Mode: High ambient light to "see in dark"
                hemiLight.color.setHex(0x00FF00);
                hemiLight.groundColor.setHex(0x003300);
                hemiLight.intensity = 2.0; // Artificial gain
            } else {
                // Normal Mode
                hemiLight.color.lerp(new THREE.Color(skyHex), dt * 0.5);
                hemiLight.groundColor.lerp(new THREE.Color(groundHex), dt * 0.5);

                // Cloud shadows affect ambient too? Maybe slightly
                // If direct light is blocked by clouds, ambient drops a bit too
                const cloudAmbient = (sunIntensity < 0.5 && dayIntensity > 0.5) ? 0.5 : 1.0;
                hemiLight.intensity = (0.2 + (dayIntensity * 0.6)) * cloudAmbient;
            }
        }

        // Sky Sphere Rotation
        if (this.skySphere) {
            this.skySphere.rotation.y += 0.01 * dt;
            this.skySphere.material.color.copy(currentSky);
        }

        // --- END CYCLE ---

        if (this.character) {
            this.character.update(dt);

            // Pass remote colliders (meshes) for Player-Player and Player-Vehicle Collision
            let allColliders = Object.values(this.remotePlayers).map(p => p.mesh).filter(m => m);

            if (this.vehicleManager) {
                allColliders = allColliders.concat(this.vehicleManager.vehicles.map(v => v.mesh).filter(m => m));
            }
            if (this.npcManager && this.npcManager.cars) {
                allColliders = allColliders.concat(this.npcManager.cars.filter(m => m));
            }

            this.character.remoteColliders = allColliders;
        }

        if (this.npcManager) this.npcManager.update(dt);

        if (this.weaponManager) {
            // Pass remote players (instances) for Hit Detection
            this.weaponManager.remotePlayers = Object.values(this.remotePlayers);
            this.weaponManager.update(dt);
        }

        // Vehicle System Update
        if (this.vehicleManager && this.character) {
            const input = this.character.inputVector || { x: 0, y: 0 };
            this.vehicleManager.update(dt, input);

            // SAVE MOTORCYCLE POSITION (Throttled or every frame? Let's do every frame for simplicity, or every few frames)
            // Just find the motorcycle
            const moto = this.vehicleManager.vehicles.find(v => v.type === 'motorcycle');
            if (moto && moto.mesh) {
                localStorage.setItem('motorcyclePosition', JSON.stringify({
                    x: moto.mesh.position.x,
                    y: moto.mesh.position.y,
                    z: moto.mesh.position.z
                }));
            }
        }

        // Camera Update (Must run AFTER character and vehicle physics move the mesh)
        if (this.character && !this.isInspectionMode) {
            this.character.updateCamera(dt);
        } else if (this.isInspectionMode && this.orbitControls) {
            this.orbitControls.update();
        }

        // CAMERA ZOOM LOGIC
        if (this.character && this.camera && this.character.desiredFOV) {
            const targetFOV = this.character.desiredFOV;
            const speed = 5.0;
            const t = 1.0 - Math.pow(0.01, dt * speed);

            if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
                this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, t);
                this.camera.updateProjectionMatrix();
            }
        }

        // Update Remote Players (Animations & Name Tags)
        Object.values(this.remotePlayers).forEach(p => p.update(dt, this.camera));

        // NETWORK: Send Update (Pulse every frame)
        if (this.character && this.networkManager) {
            this.networkManager.sendUpdate(
                this.character.mesh.position,
                this.character.yaw,
                this.character.state,
                this.weaponManager ? this.weaponManager.currentWeaponType : 'pistol'
            );

            // SAVE CHARACTER POSITION
            // Save only if not driving (so we don't save the character exactly at the vehicle pos constantly while inside)
            // Actually, we can save it always. It's fine.
            localStorage.setItem('characterPosition', JSON.stringify({
                x: this.character.mesh.position.x,
                y: this.character.mesh.position.y,
                z: this.character.mesh.position.z
            }));
        }


        // --- TELEPORTATION LOGIC ---
        if (this.character && !this.character.isDriving && this.transporters.length > 0) {
            if (this.teleportCooldown > 0) {
                this.teleportCooldown -= dt;
            } else {
                let onAnyPad = false;
                this.transporters.forEach((t, i) => {
                    const dist = this.character.mesh.position.distanceTo(t.pos);
                    if (dist < 2.0) { // On pad radius
                        onAnyPad = true;
                        t.timer += dt;
                        if (t.timer >= 2.0) {
                            // TELEPORT!
                            let targetIdx;
                            do {
                                targetIdx = Math.floor(Math.random() * this.transporters.length);
                            } while (targetIdx === i);

                            const target = this.transporters[targetIdx];
                            this.character.mesh.position.copy(target.pos);
                            this.character.mesh.position.y += 0.5; // Avoid clipping
                            this.teleportCooldown = 3.0; // 3s cooldown
                            t.timer = 0;
                            console.log(`POOF! Teleported to pad ${targetIdx}`);
                            if (this.soundManager) {
                                // this.soundManager.play('teleport'); // If added later
                            }
                        }
                    } else {
                        t.timer = 0;
                    }
                });
            }
        }

        if (this.vrMode) {
            this.stereoEffect.render(this.scene, this.camera);
        } else {
            // MAIN PASS
            this.renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
            this.renderer.setScissor(0, 0, window.innerWidth, window.innerHeight);
            this.renderer.setScissorTest(true);
            this.renderer.render(this.scene, this.camera);

            // 3D CORNER MINIMAP PASS (PiP)
            const minimapEl = document.getElementById('minimap-canvas');
            if (this.minimap && !this.minimap.isFullMap && minimapEl && minimapEl.style.display !== 'none') {
                if (this.minimapCamera && this.character && this.character.mesh) {
                    this.minimapCamera.position.x = this.character.mesh.position.x;
                    this.minimapCamera.position.z = this.character.mesh.position.z;

                    const size = 200;
                    const glX = window.innerWidth - size - 10;
                    // Convertir Top: 10px a coordenadas Bottom-Left de WebGL
                    const glY = window.innerHeight - size - 10;

                    this.renderer.setViewport(glX, glY, size, size);
                    this.renderer.setScissor(glX, glY, size, size);

                    this.renderer.autoClear = false;
                    this.renderer.clearDepth(); // Clear depth buffer so sky doesn't clip

                    // DISABLE FOG TEMPORARILY FOR PiP SO IT DOESN'T GET COVERED IN GREEN
                    const tempFog = this.scene.fog;
                    this.scene.fog = null;

                    this.renderer.render(this.scene, this.minimapCamera);

                    this.scene.fog = tempFog; // RESTORE
                    this.renderer.autoClear = true; // Restaurar
                }
            }

            // --- ACTUALIZAR ICONOS 2D SOBRE EL MAPA (PROYECCIÓN SINCRONIZADA) ---
            if (this.minimap && this.character && this.character.mesh) {
                // ELEGIR CÁMARA: Si es pantalla completa usamos la del DRONE (this.camera), si es esquina usamos la CENITAL (this.minimapCamera)
                const activeCam = this.minimap.isFullMap ? this.camera : this.minimapCamera;

                this.minimap.update(
                    this.character,
                    this.remotePlayers,
                    this.npcManager,
                    this.vehicleManager,
                    activeCam
                );
            }
        }
    }

    toggleVR() {
        this.vrMode = !this.vrMode;
        if (this.vrMode) {
            // Recalculate size to ensure split screen fits
            this.stereoEffect.setSize(window.innerWidth, window.innerHeight);
            console.log("VR Side-by-Side Mode Enabled");
        } else {
            console.log("VR Mode Disabled");
        }
    }

    triggerShake(intensity = 0.5) {
        if (!this.camera) return;
        const originalPos = this.camera.position.clone();
        const startTime = Date.now();
        const duration = 500; // ms

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
