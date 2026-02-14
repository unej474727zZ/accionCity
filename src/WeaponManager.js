import * as THREE from 'three';
import { Bullet } from './Bullet';
import { SoundManager } from './SoundManager';

export class WeaponManager {
    constructor(scene, characterController, camera, assets) {
        this.scene = scene;
        this.characterController = characterController;
        this.character = characterController.mesh; // Extract mesh from controller
        this.camera = camera;
        this.assets = assets;
        this.camera = camera;
        this.assets = assets;
        this.soundManager = new SoundManager(camera);
        console.log("WeaponManager Loaded: VERSION CHECK 9000");

        this.rightHandBone = null;
        this.currentWeaponMesh = null;
        this.currentWeaponType = null; // 'pistol' | 'rifle'

        // Weapon Configs (Offsets for valid hand placement)
        // Weapon Configs (Offsets for valid hand placement)
        this.configs = {
            pistol: { // pistol.glb (Handgun)
                scale: 15.0,
                position: new THREE.Vector3(0, -0.2, 0.5),
                // User: "Rotate half a circumference (180)" -> -90 + 180 = +90 (PI/2)
                rotation: new THREE.Vector3(Math.PI, Math.PI / 2, 0),
                fireRate: 0.25 // Seconds between shots
            },
            rifle: { // awp.glb (Sniper)
                scale: 250.0,
                // User: "Lower a bit" -> -0.4 Y
                position: new THREE.Vector3(0, -0.4, 0.5),
                position: new THREE.Vector3(0, -0.4, 0.5),
                // User: "Perfect" -> X=2.77, Y=5.74, Z=-64.00
                rotation: new THREE.Vector3(2.77, 5.74, -64.00),
                fireRate: 0.15 // Rapid fire
            }
        };

        this.findHandBone();

        // Input State
        this.isFiring = false;
        this.timeSinceLastShot = 0;

        // Input Setup
        this.setupInput();
        this.createRangeFinderUI();

        // Effects
        this.flashLight = new THREE.PointLight(0xffaa00, 0, 5);
        this.flashLight.position.set(0, 0, 0);
        this.scene.add(this.flashLight);

        // Crosshair Element
        this.crosshairEl = document.getElementById('crosshair');
        if (!this.crosshairEl) console.error("WeaponManager: Crosshair element NOT FOUND in DOM!");
        else console.log("WeaponManager: Crosshair element found.");

        // Bullet Cam Init
        this.bullets = [];
        this.activeBullet = null; // The one we follow
        this.bulletCamTimer = 0;

        // Laser Sight
        this.laserActive = false;
        const laserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
        this.laserMesh = new THREE.Line(laserGeom, laserMat);
        this.laserMesh.frustumCulled = false; // Always render
        this.scene.add(this.laserMesh);
        this.laserMesh.visible = false;
    }

    findHandBone() {
        if (!this.character) return;
        // ... (rest of findHandBone logic is unchanged)
        let bestBone = null;
        this.character.traverse((child) => {
            if (child.isBone) {
                if (bestBone && bestBone.name.toLowerCase().endsWith('righthand')) return;
                const name = child.name.toLowerCase();
                if (name.includes('righthand') && !name.includes('thumb') && !name.includes('index') && !name.includes('middle') && !name.includes('ring') && !name.includes('pinky')) {
                    bestBone = child;
                }
                else if (!bestBone && (name.includes('hand.r') || name.includes('hand_r'))) {
                    bestBone = child;
                }
            }
        });
        if (bestBone) {
            this.rightHandBone = bestBone;
            console.log("WeaponManager: Selected Best Bone:", bestBone.name);
        }
    }

    toggleLaser() {
        this.laserActive = !this.laserActive;
        // Only show laser usage if UI is meant to be visible?
        // Actually laser is in-world, but crosshair is UI.
        this.laserMesh.visible = this.laserActive;
        console.log("Laser " + (this.laserActive ? "ON" : "OFF"));
    }

    toggleUI(visible) {
        const display = visible ? 'block' : 'none';
        if (this.crosshairEl) this.crosshairEl.style.display = display;
        if (this.debugEl) this.debugEl.style.display = display;
        if (this.rangeEl) this.rangeEl.style.display = display;
    }

    cycleWeapon() {
        if (this.currentWeaponType === 'pistol') this.equip('rifle');
        else this.equip('pistol');
    }

    setupInput() {
        // ... (rest of setupInput)
        // Create Debug Display
        this.debugEl = document.createElement('div');
        this.debugEl.style.position = 'absolute';
        this.debugEl.style.top = '10px';
        this.debugEl.style.left = '50%';
        this.debugEl.style.transform = 'translateX(-50%)';
        this.debugEl.style.color = 'yellow';
        this.debugEl.style.fontWeight = 'bold';
        this.debugEl.style.fontSize = '20px';
        this.debugEl.style.fontFamily = 'monospace';
        this.debugEl.style.pointerEvents = 'none';
        this.debugEl.style.zIndex = '9999';
        this.debugEl.innerText = "CONTROLS: 8/2(X) 4/6(Y) Q/E(Z)";
        document.body.appendChild(this.debugEl);

        window.addEventListener('keydown', (e) => {
            // Weapon Switching
            if (e.key === '1') this.equip('pistol');
            if (e.key === '2') this.equip('rifle');

            // ROTATION CONTROLS (Only if weapon equipped)
            if (this.currentWeaponMesh) {
                const step = 0.05; // Finer control
                const rot = this.currentWeaponMesh.rotation;
                let changed = false;

                // X Axis: 8 (Up), 2 (Down)
                if (e.key === '8') { rot.x += step; changed = true; }
                if (e.key === '2') { rot.x -= step; changed = true; }

                // Y Axis: 4 (Left), 6 (Right)
                if (e.key === '4') { rot.y += step; changed = true; }
                if (e.key === '6') { rot.y -= step; changed = true; }

                // Z Axis: Q / E
                if (e.key === 'q' || e.key === 'Q') { rot.z += step; changed = true; }
                if (e.key === 'e' || e.key === 'E') { rot.z -= step; changed = true; }

                if (changed) {
                    this.updateDebugDisplay();
                    console.log(`ROTATION: X=${rot.x.toFixed(2)}, Y=${rot.y.toFixed(2)}, Z=${rot.z.toFixed(2)}`);
                }
            }
        });

        window.addEventListener('mousedown', (e) => {
            if (e.button === 0) {
                if (!this.currentWeaponMesh) return; // Prevent firing if no weapon

                this.isFiring = true;
                // Shoot immediately
                this.shoot();
                // NO Firing Pose (ADS) - Keeps weapon in hand
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (e.button === 0) {
                this.isFiring = false;
                // No need to restore parent/transform if we didn't change it
            }
        });

        // Safety: Stop firing if mouse leaves window
        window.addEventListener('blur', () => { this.isFiring = false; });

        // Toggle Laser Sight (R)
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyR') {
                this.laserActive = !this.laserActive;
                this.laserMesh.visible = this.laserActive;
                // Play sound?
                if (this.laserActive) console.log("Laser ON");
                else console.log("Laser OFF");
            }
        });
    }

    updateDebugDisplay() {
        if (this.currentWeaponMesh && this.debugEl) {
            const r = this.currentWeaponMesh.rotation;
            this.debugEl.innerText = `CONTROLS: 8/2(X) 4/6(Y) Q/E(Z)\nROT: X=${r.x.toFixed(2)} Y=${r.y.toFixed(2)} Z=${r.z.toFixed(2)}`;
        }
    }

    createRangeFinderUI() {
        this.rangeEl = document.createElement('div');
        this.rangeEl.style.position = 'absolute';
        this.rangeEl.style.top = '52%'; // Slightly below center
        this.rangeEl.style.left = '52%'; // Slightly right of center
        this.rangeEl.style.transform = 'translate(-50%, -50%)';
        this.rangeEl.style.color = '#00ff00'; // Neon Green
        this.rangeEl.style.fontFamily = 'monospace';
        this.rangeEl.style.fontSize = '24px';
        this.rangeEl.style.fontWeight = 'bold';
        this.rangeEl.style.textShadow = '0 0 5px #00ff00';
        this.rangeEl.style.pointerEvents = 'none';
        this.rangeEl.innerText = "--- m";
        document.body.appendChild(this.rangeEl);
    }

    updateRangeFinder() {
        if (!this.rangeEl || !this.camera) return;

        const raycaster = new THREE.Raycaster();
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        raycaster.set(this.camera.position, direction);
        raycaster.far = 2000; // 2km range

        // Intersect
        const visualObjects = [];
        this.scene.traverse(c => {
            if (c.isMesh && c !== this.currentWeaponMesh && c !== this.character) {
                visualObjects.push(c);
            }
        });

        const hits = raycaster.intersectObjects(visualObjects, false);
        if (hits.length > 0) {
            const dist = hits[0].distance;
            this.rangeEl.innerText = `${dist.toFixed(1)} m`;
            this.rangeEl.style.color = (dist < 100) ? '#ff0000' : '#00ff00'; // Red if close
        } else {
            this.rangeEl.innerText = "---";
        }
    }

    equip(type) {
        // Stop firing when switching
        this.isFiring = false;

        // Fallback to character root if bone missing
        let parent = this.rightHandBone;
        if (!parent) {
            console.warn("Right Hand Bone not found! Attaching to Character Root for debugging.");
            parent = this.character; // Attach to root
        }

        if (!parent) {
            console.error("Cannot equip: No parent object found (Character is null?)");
            return;
        }

        if (!this.assets[type]) {
            console.warn(`Cannot equip: Asset '${type}' not found in assets! Available:`, Object.keys(this.assets));
            return;
        }

        // Remove old
        if (this.currentWeaponMesh) {
            if (this.currentWeaponMesh.parent) {
                this.currentWeaponMesh.parent.remove(this.currentWeaponMesh);
            }
            this.currentWeaponMesh = null;
        }

        // Create new
        const original = this.assets[type].scene;
        this.currentWeaponMesh = original.clone();
        this.currentWeaponType = type;

        // Apply Transforms
        const config = this.configs[type] || { scale: 1, position: new THREE.Vector3(), rotation: new THREE.Vector3() };

        this.currentWeaponMesh.scale.set(config.scale, config.scale, config.scale);
        this.currentWeaponMesh.position.copy(config.position);
        if (config.rotation) {
            this.currentWeaponMesh.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
        }

        parent.add(this.currentWeaponMesh);
        console.log(`Equipped: ${type} to ${parent.name || 'Root'}`);

        // ANIMATION SYNC & CROSSHAIR
        // ANIMATION SYNC & CROSSHAIR
        if (this.characterController) {
            // Let CharacterController handle stance updates via update() loop
            // checking this.currentWeaponType
            console.log(`WeaponManager: Switched to ${type}`);
        }

        // Show Crosshair
        if (this.crosshairEl) {
            this.crosshairEl.style.display = 'block';
        }
    }

    shoot() {
        if (!this.currentWeaponMesh) return;

        // Reset Timer
        this.timeSinceLastShot = 0;

        console.log("Bang! Bullet Time!");

        // Sound
        if (this.soundManager) {
            this.soundManager.playShoot(this.currentWeaponType);
        }

        console.log("DEBUG: VERSION 9005");
        if (this.currentWeaponMesh && this.currentWeaponMesh.parent) {
            console.log("Weapon Parent:", this.currentWeaponMesh.parent.name);
            const bonePos = new THREE.Vector3();
            this.currentWeaponMesh.parent.getWorldPosition(bonePos);
            console.log("Bone World Pos:", bonePos);
        } else {
            console.log("Weapon Parent: NULL/NONE");
        }

        // 1. Muzzle Position
        const gunPos = new THREE.Vector3();
        this.currentWeaponMesh.getWorldPosition(gunPos);

        console.log(`Gun World Pos: X=${gunPos.x.toFixed(2)}, Y=${gunPos.y.toFixed(2)}, Z=${gunPos.z.toFixed(2)}`);

        // 2. Aim Direction (Converge on Crosshair)
        // Get point 1000 units in front of camera (Increased from 100 for better long range accuracy)
        const targetPoint = new THREE.Vector3();
        this.camera.getWorldDirection(targetPoint);
        const camDir = targetPoint.clone(); // Save direction for raycast
        targetPoint.multiplyScalar(1000); // 1000m range
        targetPoint.add(this.camera.position);

        // Calculate direction from Gun Muzzle to Target Point
        const bulletDir = new THREE.Vector3().subVectors(targetPoint, gunPos).normalize();

        // Spawn Bullet (slightly forward to avoid self-collision)
        const spawnPos = gunPos.clone().add(bulletDir.multiplyScalar(0.5));

        // Flash
        this.flashLight.position.copy(gunPos);
        this.flashLight.intensity = 5;
        setTimeout(() => { this.flashLight.intensity = 0; }, 50);

        // 3. Create Bullet
        // Speed: 100.0 (Faster)
        const bullet = new Bullet(this.scene, spawnPos, bulletDir, 100.0);
        this.bullets.push(bullet);

        // 4. HIT SCAN (Instant Hit Detection)
        // Use a Raycaster from the camera to see what we hit
        const raycaster = new THREE.Raycaster();
        raycaster.set(this.camera.position, camDir); // Use camera forward direction
        raycaster.far = 1000; // 1000 meters range

        // Intersect everything except:
        // - The character itself
        // - The current weapon
        let visualObjects = [];
        this.scene.traverse(c => {
            if (c.isMesh && c !== this.currentWeaponMesh && c !== this.character) {
                visualObjects.push(c);
            }
        });

        // Add Remote Players Explicitly
        if (this.remotePlayers) {
            this.remotePlayers.forEach(p => {
                if (p.mesh) {
                    p.mesh.traverse(c => {
                        if (c.isMesh) visualObjects.push(c);
                    });
                }
            });
        }

        const hits = raycaster.intersectObjects(visualObjects, false);

        if (hits.length > 0) {
            const hit = hits[0];

            // Determine Impact Type
            let impactType = 'spark';

            // Check if hit object is a player (SkinnedMesh or parent is RemotePlayer mesh)
            let obj = hit.object;
            while (obj) {
                if (obj.type === 'SkinnedMesh') { // Players are SkinnedMeshes
                    impactType = 'blood';
                    break;
                }
                obj = obj.parent;
            }

            // Create Impact Effect at hit point
            this.createImpact(hit.point, impactType);
        }
        // 4. HIT SCAN (Instant Hit Detection)
        // ... (Hit scan logic remains)

        // 5. BULLET CAM (Disabled)
        // this.setupBulletTime(bullet);
    }

    createImpact(point, type = 'spark') {
        // Spark or Blood
        const color = type === 'blood' ? 0xff0000 : 0xffff88;
        const scaleMax = type === 'blood' ? 1.5 : 1.0;

        const geom = new THREE.SphereGeometry(0.2, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.9
        });
        const spark = new THREE.Mesh(geom, mat);
        spark.position.copy(point);
        this.scene.add(spark);

        // Animate Scale/Fade
        let scale = 0.5;
        const animateSpark = () => {
            scale += 0.1;
            spark.scale.set(scale, scale, scale);
            spark.material.opacity -= 0.1; // Faster fade
            if (spark.material.opacity > 0) {
                requestAnimationFrame(animateSpark);
            } else {
                this.scene.remove(spark);
                geom.dispose();
                mat.dispose();
            }
        };
        animateSpark();
    }


    update(dt) {
        this.updateRangeFinder();

        // Update Laser Sight
        if (this.laserActive && this.currentWeaponMesh && this.laserMesh.visible) {
            // Start: Gun Muzzle Position
            const start = new THREE.Vector3();
            this.currentWeaponMesh.getWorldPosition(start);
            // Height adjustment for barrel (approx 0.1m up from pivot depending on model)
            // We can improve this with a specific 'muzzle' bone later if needed
            start.y += 0.1;

            // End: Raycast Hit (Aim Point)
            const raycaster = new THREE.Raycaster();
            const direction = new THREE.Vector3();
            // Get camera direction
            this.camera.getWorldDirection(direction);
            raycaster.set(this.camera.position, direction);
            raycaster.far = 1000;

            // Intersect Checks (Same as shoot: ignore self/weapon)
            let targets = [];
            this.scene.traverse(c => {
                if (c.isMesh && c !== this.currentWeaponMesh && c !== this.character && c.visible) {
                    targets.push(c);
                }
            });
            // Add Remote Players
            if (this.remotePlayers) {
                this.remotePlayers.forEach(p => {
                    if (p.mesh) {
                        p.mesh.traverse(c => {
                            if (c.isMesh) targets.push(c);
                        });
                    }
                });
            }

            const hits = raycaster.intersectObjects(targets, false);
            const end = new THREE.Vector3();

            if (hits.length > 0) {
                end.copy(hits[0].point);
            } else {
                // Max Range point
                end.copy(this.camera.position).add(direction.multiplyScalar(100)); // 100m default length
            }

            // Update Geometry
            const positions = this.laserMesh.geometry.attributes.position.array;
            positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
            positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
            this.laserMesh.geometry.attributes.position.needsUpdate = true;

            // Critical: Update bounding sphere so it doesn't disappear when camera turns
            this.laserMesh.geometry.computeBoundingSphere();
        }


        // Retry finding bone if missing
        if (!this.rightHandBone && this.character) {
            this.findHandBone();
            if (this.rightHandBone && !this.currentWeaponMesh) {
                this.equip('pistol');
            }
        }

        // Auto-Fire Logic
        this.timeSinceLastShot += dt;
        if (this.isFiring && this.currentWeaponType) {
            const rate = this.configs[this.currentWeaponType].fireRate || 0.5;
            if (this.timeSinceLastShot >= rate) {
                this.shoot();
            }
        }

        // Update Bullets
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.update(dt);
            if (!b.active) {
                this.bullets.splice(i, 1);
            }
        }

        // Bullet Camera Logic (Currently Disabled/Unused if shoot() doesn't set activeBullet)
        if (this.activeBullet && this.activeBullet.active) {
            // Override Camera Position
            // Position camera slightly behind and up from bullet
            const offset = this.activeBullet.direction.clone().multiplyScalar(-2.0).add(new THREE.Vector3(0, 0.5, 0));
            this.camera.position.copy(this.activeBullet.mesh.position).add(offset);
            this.camera.lookAt(this.activeBullet.mesh.position);

            this.bulletCamTimer -= dt;

            // Enforce Override on every frame of bullet time
            if (this.characterController) this.characterController.overrideCamera = true;

            if (this.bulletCamTimer <= 0) {
                this.activeBullet.speed = 50.0; // Resume speed
                this.activeBullet = null; // Release camera
                if (this.characterController) this.characterController.overrideCamera = false;
            }
        } else {
            // Ensure override is released if we lost bullet
            // But don't spam it if already false (optional optimization)
            if (this.characterController) this.characterController.overrideCamera = false;
        }
    }
}
