import * as THREE from 'three';
import { AssetLoader } from './AssetLoader.js';
import { CharacterController } from './CharacterController.js';
import { NPCManager } from './NPCManager.js';
import { NetworkManager } from './NetworkManager.js';
import { RemotePlayer } from './RemotePlayer.js';
import { WeaponManager } from './WeaponManager.js';
import { Minimap } from './Minimap.js';

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
        dirLight.castShadow = true;

        // Shadow High Quality
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;

        // Configure shadow camera volume to cover the city view
        const d = 100;
        dirLight.shadow.camera.left = -d;
        dirLight.shadow.camera.right = d;
        dirLight.shadow.camera.top = d;
        dirLight.shadow.camera.bottom = -d;

        this.scene.add(dirLight);

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
            this.character.world = this;

            // MINIMAP
            this.minimap = new Minimap();
            // Start with Pistol equipped? Or wait for input? Let's equip Pistol by default.
            // But we need to make sure model is ready. Construct it now, call equip later or inside.

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
            statusEl.innerText = 'DISCONNECTED';
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
            });

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

    toggleNightVision() {
        this.isNightVision = !this.isNightVision;
        console.log("Night Vision:", this.isNightVision);
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

        const dt = this.clock.getDelta();

        // --- DAY/NIGHT CYCLE ---
        // Cycle duration in seconds (1h Day + 1h Night = 7200s)
        const dayDuration = 7200;
        const time = Date.now() / 1000;
        const cycle = (time % dayDuration) / dayDuration; // 0 to 1

        // Sun Position (Rotate around Z axis)
        const sunAngle = (cycle * Math.PI * 2) - (Math.PI / 2); // Start at Sunrise
        const sunRadius = 200;

        let sunIntensity = 0;

        // Find the directional light
        const dirLight = this.scene.children.find(c => c.isDirectionalLight);
        if (dirLight) {
            dirLight.position.x = Math.cos(sunAngle) * sunRadius;
            dirLight.position.y = Math.sin(sunAngle) * sunRadius;
            dirLight.position.z = 50;

            // Base intensity based on height
            sunIntensity = Math.max(0, Math.sin(sunAngle) * 1.5);

            // --- CLOUD SHADOWS ---
            // Use sine waves to simulate passing clouds
            const cloudNoise = Math.sin(time * 0.1) + Math.sin(time * 0.05) + Math.cos(time * 0.02);
            // If noise is high, it's a "cloudy moment"
            let cloudFactor = 1.0;
            if (cloudNoise > 1.0) { // Arbitrary threshold for "cloud passing"
                cloudFactor = 0.3; // Dim significantly
            }

            // Apply Cloud Dimming
            sunIntensity *= cloudFactor;

            dirLight.mask = (dirLight.position.y > 0) ? 1 : 0;
            dirLight.intensity = sunIntensity;
            dirLight.castShadow = (dirLight.position.y > 10);
        }

        // Sky Color Interpolation
        let skyHex = 0x000000;
        let groundHex = 0x111111;
        let fogDist = 150;
        let fogColor = null;

        const dayIntensity = Math.max(0, Math.sin(sunAngle));

        if (dayIntensity > 0.8) {
            skyHex = 0x87CEEB; // Blue
            groundHex = 0x555555;
        } else if (dayIntensity > 0.2) {
            skyHex = 0xFF4500; // Orange
            groundHex = 0x332222;
            fogDist = 100;
        } else {
            skyHex = 0x050510; // Night
            groundHex = 0x000000;
            fogDist = 80;
        }

        // --- NIGHT VISION OVERRIDE ---
        if (this.isNightVision) {
            skyHex = 0x002200; // Dark Green
            groundHex = 0x004400; // Brighter Green Floor
            fogDist = 200; // See further in dark
            fogColor = new THREE.Color(0x00FF00); // Bright Green Fog
        }

        // Smoothly lerp current color to target
        const currentSky = this.scene.background;
        currentSky.lerp(new THREE.Color(skyHex), dt * 0.5);

        // Update Fog
        if (fogColor) {
            this.scene.fog.color.lerp(fogColor, dt * 2.0); // Fast transition to NV
        } else {
            this.scene.fog.color.copy(currentSky);
        }

        this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, fogDist, dt * 0.5);

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

        // Update Weapons (Effects)
        if (this.weaponManager) {
            this.weaponManager.update(dt);
        }

        // Update Minimap
        if (this.minimap && this.character && this.character.mesh) {
            this.minimap.update(this.character.mesh, this.remotePlayers, this.npcManager);
        }

        // NETWORK: Send Update
        if (this.character) {
            this.networkManager.sendUpdate(
                this.character.mesh.position,
                this.character.yaw,
                this.character.state
            );
        }

        if (this.character) {
            this.character.update(dt);
            // Pass remote colliders for Player-Player Collision
            this.character.remoteColliders = Object.values(this.remotePlayers).map(p => p.mesh);
        }

        if (this.npcManager) this.npcManager.update(dt);

        if (this.weaponManager) {
            // Pass remote players for Hit Detection & Laser Sight
            this.weaponManager.remotePlayers = Object.values(this.remotePlayers).map(p => p.mesh);
            this.weaponManager.update(dt);
        }

        // CAMERA ZOOM LOGIC
        if (this.character && this.camera && this.character.desiredFOV) {
            const targetFOV = this.character.desiredFOV;
            // Stable Time-Based Lerp (Frame-rate independent dampening)
            // lerp(current, target, 1 - exp(-speed * dt))
            const speed = 5.0;
            const t = 1.0 - Math.pow(0.01, dt * speed);

            if (Math.abs(this.camera.fov - targetFOV) > 0.1) {
                this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFOV, t);
                this.camera.updateProjectionMatrix();
            }
        }

        // Update Remote Players (Animations & Name Tags)
        Object.values(this.remotePlayers).forEach(p => p.update(dt, this.camera));

        this.renderer.render(this.scene, this.camera);
    }
}
