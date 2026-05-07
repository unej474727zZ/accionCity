import * as THREE from 'three';
import { Bullet } from './Bullet.js';
import { SoundManager } from './SoundManager.js';

class TankShell {
    constructor(scene, position, direction, speed, onHit) {
        this.scene = scene;
        this.position = position.clone();
        this.direction = direction.clone();
        this.speed = speed;
        this.onHit = onHit;
        this.alive = true;
        this.distanceTraveled = 0;
        this.maxDistance = 1000;

        // Visual Mesh
        const geom = new THREE.SphereGeometry(0.3, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.copy(this.position);

        // Add point light for glow
        this.light = new THREE.PointLight(0xffaa00, 2, 10);
        this.mesh.add(this.light);

        this.scene.add(this.mesh);
    }

    update(dt) {
        if (!this.alive) return;

        const step = this.speed * dt;
        this.position.add(this.direction.clone().multiplyScalar(step));
        this.mesh.position.copy(this.position);
        this.distanceTraveled += step;

        if (this.distanceTraveled >= this.maxDistance) {
            this.destroy();
            return;
        }

        // Simple proximity check for hit
        if (this.hitPoint && this.position.distanceTo(this.hitPoint) < step * 1.5) {
            this.onHit(this.hitPoint, this.hitNormal, this.hitObject);
            this.destroy();
        }
    }

    destroy() {
        this.alive = false;
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

class HeliMissile {
    constructor(scene, position, direction, speed, onHit) {
        this.scene = scene;
        this.position = position.clone();
        this.direction = direction.clone();
        this.speed = speed;
        this.onHit = onHit;
        this.alive = true;
        this.distanceTraveled = 0;
        this.maxDistance = 1500;

        // Visual Mesh: Cylinder (Missile shape)
        const geom = new THREE.CylinderGeometry(0.15, 0.15, 2.0, 8);
        geom.rotateX(Math.PI / 2); // Align with velocity
        const mat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x111111 });
        this.mesh = new THREE.Mesh(geom, mat);
        this.mesh.position.copy(this.position);
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);

        // Exhaust Flame
        const flameGeom = new THREE.SphereGeometry(0.2, 8, 8);
        const flameMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
        this.flame = new THREE.Mesh(flameGeom, flameMat);
        this.flame.position.set(0, 0, -1.2); // At the back
        this.mesh.add(this.flame);

        // Point light for glow
        this.light = new THREE.PointLight(0xffaa00, 3, 15);
        this.mesh.add(this.light);

        this.scene.add(this.mesh);
    }

    update(dt) {
        if (!this.alive) return;

        // HOMING MECHANIC (LOCK-ON)
        if (this.targetVehicle && this.targetVehicle.mesh) {
            const targetPos = this.targetVehicle.mesh.position.clone();
            // Aim slightly above ground
            targetPos.y += 1.5;

            const toTarget = targetPos.clone().sub(this.position).normalize();
            // Steer towards target (turn rate: 3.0 radians per second)
            this.direction.lerp(toTarget, dt * 3.0).normalize();

            // Align mesh
            this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);

            // Update hit point dynamically
            this.hitPoint = targetPos;
        }

        const step = this.speed * dt;
        this.position.add(this.direction.clone().multiplyScalar(step));
        this.mesh.position.copy(this.position);
        this.distanceTraveled += step;

        // Visual flicker for flame
        if (this.flame) {
            const scale = 0.8 + Math.random() * 0.4;
            this.flame.scale.set(scale, scale, scale * 2);
        }

        if (this.distanceTraveled >= this.maxDistance) {
            // Trigger area explosion anyway
            this.onHit(this.position, new THREE.Vector3(0, 1, 0), null);
            this.destroy();
            return;
        }

        if (this.hitPoint && this.position.distanceTo(this.hitPoint) < step * 2.0) {
            this.onHit(this.hitPoint, this.hitNormal, this.hitObject);
            this.destroy();
        }
    }

    destroy() {
        this.alive = false;
        this.scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
    }
}

export class WeaponManager {
    constructor(scene, characterController, camera, assets) {
        this.scene = scene;
        this.characterController = characterController;
        this.character = characterController.mesh; // Extract mesh from controller
        this.camera = camera;
        this.assets = assets;
        this.soundManager = this.scene.userData.world ? this.scene.userData.world.soundManager : null;
        if (!this.soundManager) console.warn("WeaponManager: SoundManager not found in World context");
        console.log("WeaponManager Loaded: VERSION CHECK 9007");

        this.rightHandBone = null;
        this.currentWeaponMesh = null;
        this.currentWeaponType = null; // 'pistol' | 'rifle'
        this.remotePlayers = []; // List of remote players for hit detection
        this.tankShells = []; // List of active tank shells
        this.canisters = []; // List of explosive canisters

        // Weapon Configs (Offsets for valid hand placement)
        // Weapon Configs (Offsets for valid hand placement)
        this.configs = {
            pistol: { // pistol.glb (Handgun)
                scale: 15.0,
                position: new THREE.Vector3(0.05, -0.2, 0.4),
                // Eliminamos la inversión de 180° (Math.PI) que la ponía boca abajo
                rotation: new THREE.Vector3(0, Math.PI / 2, 0),
                fireRate: 0.25 // Seconds between shots
            },
            rifle: { // awp.glb (Sniper)
                scale: 250.0,
                // User: "Lower a bit" -> -0.4 Y
                position: new THREE.Vector3(0, -0.4, 0.5),
                // User: "Perfect" -> X=2.77, Y=5.74, Z=-64.00
                rotation: new THREE.Euler(2.77, 5.74, -64.00),
                fireRate: 0.8 // Rapid fire
            },
            bazooka: { // bazooka.glb
                scale: 15.0, // Adjust later if needed
                position: new THREE.Vector3(0.5, 0.4, 0.3), // Shoulder position
                rotation: new THREE.Euler(0, Math.PI, 0), // Forward
                fireRate: 2.0 // Slow fire rate
            }
        };

        this.findHandBone();

        // Input State
        this.isFiring = false;
        this.isReloading = false;
        this.timeSinceLastShot = 0;

        // Ammo State
        this.maxAmmo = { pistol: 12, rifle: 30, bazooka: 2 };
        this.ammo = { pistol: 12, rifle: 30, bazooka: 2 };

        // Input Setup
        this.setupInput();
        this.createAmmoUI(); // NEW
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
        this.laserActive = true;
        this.laserMesh = this.createLaser();
        this.scene.add(this.laserMesh);

        // --- AR TACTICAL OVERLAY (Tank Mode) ---
        this.arMarkers = new Map(); // Map: UUID -> DOM Element
        this.arContainer = document.createElement('div');
        this.arContainer.id = 'ar-tactical-hud';
        this.arContainer.style.position = 'absolute';
        this.arContainer.style.top = '0';
        this.arContainer.style.left = '0';
        this.arContainer.style.width = '100%';
        this.arContainer.style.height = '100%';
        this.arContainer.style.pointerEvents = 'none';
        this.arContainer.style.zIndex = '9999';
        this.arContainer.style.overflow = 'hidden';
        this.arContainer.style.display = 'none';
        document.body.appendChild(this.arContainer);

        // PERFORMANCE: Target Cache
        this.raycastTargets = [];
        this.lastTargetUpdateTime = 0;
        this.rangeFinderThrottle = 0;
        
        // PERFORMANCE: Shared Geometries
        this._sparkGeom = new THREE.SphereGeometry(0.04, 3, 3); // Ultra-low poly
        this._smokeGeom = new THREE.SphereGeometry(0.15, 4, 4);
        this._flashGeom = new THREE.SphereGeometry(0.8, 6, 6); // For explosion core

        // PERFORMANCE: Shared Materials
        this._sparkMat = new THREE.MeshBasicMaterial({ color: 0xffff88, transparent: true });
        this._bloodMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true });
        this._smokeMat = new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.5 });
    }

    isSelf(obj) {
        if (!this.character) return false;
        let temp = obj;

        // Ensure current weapon and driven vehicle are evaluated as self 
        const checkWeapon = this.currentWeaponMesh || null;
        const checkVehicle = (this.characterController && this.characterController.vehicle) ? this.characterController.vehicle.mesh : null;

        while (temp) {
            if (temp === this.character) return true;
            if (checkWeapon && temp === checkWeapon) return true;
            if (checkVehicle && temp === checkVehicle) return true;
            temp = temp.parent;
        }
        return false;
    }

    isVehiclePart(obj, vehicleMesh) {
        if (!vehicleMesh) return false;
        let temp = obj;
        while (temp) {
            if (temp === vehicleMesh) return true;
            temp = temp.parent;
        }
        return false;
    }

    createLaser() {
        const laserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const laserMesh = new THREE.Line(laserGeom, laserMat);
        laserMesh.frustumCulled = false; // Always render
        laserMesh.visible = this.laserActive;
        return laserMesh;
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

        // Hide AR if UI is hidden
        if (!visible) {
            this.arContainer.style.display = 'none';
        }
    }

    cycleWeapon() {
        if (this.currentWeaponType === 'pistol') this.equip('rifle');
        else if (this.currentWeaponType === 'rifle') this.equip('bazooka');
        else this.equip('pistol');
    }

    setupInput() {
        // ... (rest of setupInput)
        // Consolidate into the existing Debug Console
        this.debugEl = document.getElementById('debug-console');
        if (this.debugEl) {
            this.debugEl.innerText = "WEAPON SYSTEM ACTIVE";
        }

        window.addEventListener('keydown', (e) => {
            // Weapon Switching (Only with 1)
            if (e.key === '1') this.cycleWeapon();
            if (e.code === 'KeyT') this.holster();

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

        // Safety: Stop firing if mouse leaves window
        window.addEventListener('blur', () => { this.isFiring = false; });
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

    createAmmoUI() {
        this.ammoEl = document.createElement('div');
        this.ammoEl.style.position = 'absolute';
        this.ammoEl.style.bottom = '20px';
        this.ammoEl.style.right = '20px';
        this.ammoEl.style.color = '#ffffff';
        this.ammoEl.style.fontFamily = 'monospace';
        this.ammoEl.style.fontSize = '32px';
        this.ammoEl.style.fontWeight = 'bold';
        this.ammoEl.style.textShadow = '0 0 10px #ff0000, 2px 2px 2px #000';
        this.ammoEl.style.pointerEvents = 'none';
        this.ammoEl.style.display = 'none'; // Hidden until weapon equipped
        this.ammoEl.innerText = "";
        document.body.appendChild(this.ammoEl);
    }

    updateAmmoUI() {
        if (!this.ammoEl) return;
        if (!this.currentWeaponType || this.isReloading) {
            this.ammoEl.innerText = this.isReloading ? "RELOADING..." : "";
            this.ammoEl.style.color = "#ffaa00";
            return;
        }
        
        const current = this.ammo[this.currentWeaponType];
        const max = this.maxAmmo[this.currentWeaponType];
        this.ammoEl.innerText = `${current} / ${max}`;
        this.ammoEl.style.color = (current <= (max * 0.25)) ? '#ff0000' : '#ffffff';
    }

    updateRangeFinder() {
        if (!this.rangeEl || !this.camera) return;

        const raycaster = new THREE.Raycaster();
        const direction = new THREE.Vector3();
        this.camera.getWorldDirection(direction);
        raycaster.set(this.camera.position, direction);
        raycaster.far = 2000; // 2km range

        // Intersect
        const now = Date.now();
        if (now - this.lastTargetUpdateTime > 1000) { // Update target list once per second
            this.lastTargetUpdateTime = now;
            
            // PERFORMANCE: Use the consolidated list from CharacterController
            this.raycastTargets = (this.characterController && this.characterController.allPhysicTargets && this.characterController.allPhysicTargets.length > 0) ? 
                this.characterController.allPhysicTargets : 
                (this.characterController.colliders || []);
            
            // Add remote players (WeaponManager logic handles them specially too)
            if (this.remotePlayers) {
                this.remotePlayers.forEach(p => { if (p.mesh && !this.raycastTargets.includes(p.mesh)) this.raycastTargets.push(p.mesh); });
            }
        }

        const hits = raycaster.intersectObjects(this.raycastTargets, true);
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
            // Check if it's an Euler or Vector3
            if (config.rotation instanceof THREE.Euler) {
                this.currentWeaponMesh.rotation.copy(config.rotation);
            } else {
                this.currentWeaponMesh.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
            }
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

        // Show Crosshair and Ammo UI
        if (this.crosshairEl) {
            this.crosshairEl.style.display = 'block';
        }
        if (this.ammoEl) {
            this.ammoEl.style.display = 'block';
            this.updateAmmoUI();
        }

        // Show Laser if active
        if (this.laserMesh) {
            this.laserMesh.visible = this.laserActive;
        }
    }

    holster() {
        console.log("WeaponManager: Holstering weapon.");
        this.isFiring = false;

        if (this.currentWeaponMesh) {
            if (this.currentWeaponMesh.parent) {
                this.currentWeaponMesh.parent.remove(this.currentWeaponMesh);
            }
            this.currentWeaponMesh = null;
        }

        // Store the last type before clearing it
        if (this.currentWeaponType) this.lastWeaponType = this.currentWeaponType;
        this.currentWeaponType = null;

        // Hide UI
        if (this.crosshairEl) this.crosshairEl.style.display = 'none';
        if (this.rangeEl) this.rangeEl.innerText = "---";
        if (this.ammoEl) this.ammoEl.style.display = 'none';

        // Hide Laser
        if (this.laserMesh) this.laserMesh.visible = false;

        if (this.characterController) {
            console.log("WeaponManager: Holstered. CharacterController will return to idle in next update.");
        }
    }

    toggleHolster() {
        if (this.currentWeaponType) {
            this.holster();
        } else {
            // Re-equip last weapon or default to pistol
            this.equip(this.lastWeaponType || 'pistol');
        }
    }

    fireTankCannon() {
        const v = this.characterController.vehicle;
        if (!v || !v.mesh) return;
        const now = Date.now();
        if (this.lastTankShot && (now - this.lastTankShot < 2000)) return;
        this.lastTankShot = now;

        // Dynamic Muzzle Position & Direction
        let muzzlePos = new THREE.Vector3();
        let bulletDir = new THREE.Vector3();

        if (v.canon) {
            v.canon.getWorldPosition(muzzlePos);

            // Get Camera Crosshair target point
            const camDir = new THREE.Vector3();
            const camPos = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            this.camera.getWorldPosition(camPos);

            const camRay = new THREE.Raycaster(camPos, camDir);
            const camHits = camRay.intersectObjects(this.scene.children, true);

            let targetPoint = camPos.clone().add(camDir.clone().multiplyScalar(500));
            if (camHits.length > 0) {
                // Ignore hits too close to the tank itself
                const validHit = camHits.find(h => h.distance > 8);
                if (validHit) targetPoint = validHit.point;
            }

            // ORIGIN: From the turret center, projected along the barrel axis.
            // This avoids issues where the 'mount' node might have an offset pivot.
            const origin = new THREE.Vector3();
            v.turret.getWorldPosition(origin);

            // Add height to match the barrel position relative to the turret base
            origin.y += 0.8;

            const barrelQuat = new THREE.Quaternion();
            v.canon.getWorldQuaternion(barrelQuat);

            // FORWARD: Based on 'gauge' feedback, Z is the forward axis of the barrel.
            const forwardAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(barrelQuat);

            // Move origin forward by 5.5 meters along the barrel
            origin.add(forwardAxis.clone().multiplyScalar(5.5));
            muzzlePos.copy(origin);

            bulletDir.copy(targetPoint).sub(muzzlePos).normalize();

            console.log(`🔥 Tank Shot from ${v.canon.name} barrel tip!`);
        } else {
            // Fallback to hull center if nodes aren't found
            muzzlePos.copy(v.mesh.position).add(new THREE.Vector3(0, 3, 0));
            this.camera.getWorldDirection(bulletDir);
        }

        this.flashLight.position.copy(muzzlePos);
        this.flashLight.intensity = 50;
        this.flashLight.color.setHex(0xffaa00);
        setTimeout(() => { this.flashLight.intensity = 0; }, 100);
        if (this.soundManager) this.soundManager.playTankShot();

        const raycaster = new THREE.Raycaster(muzzlePos, bulletDir);
        raycaster.far = 2000;

        const targets = [];
        this.scene.traverse(c => {
            if (c.isMesh && !this.isSelf(c) && c.visible) {
                if (c.userData.type === 'bullet' || c.userData.type === 'impact_part') return;
                targets.push(c);
            }
        });
        const hits = raycaster.intersectObjects(targets, false);
        const externalHits = hits; // Already filtered by targets logic

        const hit = externalHits.length > 0 ? externalHits[0] : null;
        const targetDist = hit ? hit.distance : 200;
        const targetPoint = hit ? hit.point : muzzlePos.clone().add(bulletDir.clone().multiplyScalar(200));

        // SPAWN VISUAL SHELL
        const shell = new TankShell(this.scene, muzzlePos, bulletDir, 150.0, (pos, norm, obj) => {
            console.log("💥 TANK SHELL IMPACT:", pos);
            this.createExplosion(pos, 5.0);
            this.createImpact(pos, norm || new THREE.Vector3(0, 1, 0), 'spark', 5.0, obj); // 5x Scale

            this.applyAreaDamage(pos, 15.0, 1.0);
        });

        if (hit) {
            shell.hitPoint = hit.point;
            // Correct normal calculation: transform from local face normal to world space
            const worldNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            shell.hitNormal = worldNormal;
            shell.hitObject = hit.object;
        } else {
            shell.hitPoint = targetPoint;
        }

        this.tankShells.push(shell);
    }

    applyAreaDamage(pos, radius, damageAmount) {
        if (!this.characterController || !this.characterController.world) return;
        const vm = this.characterController.world.vehicleManager;
        const npcManager = this.characterController.world.npcManager;
        const affectedVehicles = new Set();

        // 1. Managed Vehicles (O(N) where N is small)
        for (const v of vm.vehicles) {
            if (!v.mesh) continue;
            // Using a simple distance check (not using getWorldPosition to save perf)
            if (v.mesh.position.distanceTo(pos) < radius) {
                vm.damageVehicle(v, damageAmount, v.mesh, true);
                affectedVehicles.add(v);
            }
        }

        // 2. NPC Vehicles
        if (npcManager && npcManager.cars) {
            for (const car of npcManager.cars) {
                if (!car) continue;
                if (car.position.distanceTo(pos) < radius && !affectedVehicles.has(car)) {
                    vm.damageVehicle(car, damageAmount, car, true);
                    affectedVehicles.add(car);
                }
            }
        }

        // 3. Player
        if (this.character && this.character.position.distanceTo(pos) < radius) {
            if (this.characterController.damage) this.characterController.damage(20);
        }
    }

    createExplosion(position, radius) {
        // ULTRA-LEAN EXPLOSION: Low intensity, very short life
        const boomLight = new THREE.PointLight(0xff6600, 2, radius); 
        boomLight.position.copy(position);
        this.scene.add(boomLight);
        setTimeout(() => { if (this.scene) this.scene.remove(boomLight); }, 60);

        if (this.soundManager) this.soundManager.playTankShot();

        // Minimal particles (only 2 boxes) - Using SHARED MATERIAL CLONES to allow independent opacity
        for (let i = 0; i < 2; i++) {
            const pMat = this._sparkMat.clone();
            const p = new THREE.Mesh(this._sparkGeom, pMat);
            p.position.copy(position);
            const vel = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 8, (Math.random() - 0.5) * 8);
            this.scene.add(p);
            const start = Date.now();
            const anim = () => {
                if (Date.now() - start > 300) { 
                    this.scene.remove(p); 
                    pMat.dispose(); 
                    return; 
                }
                p.position.add(vel.clone().multiplyScalar(0.016));
                vel.y -= 0.8;
                pMat.opacity -= 0.05;
                requestAnimationFrame(anim);
            };
            anim();
        }
    }

    shoot() {
        if (!this.currentWeaponMesh || !this.currentWeaponType || this.isReloading) return;

        // Ammo Check
        if (this.ammo[this.currentWeaponType] <= 0) {
            this.reload();
            return;
        }

        this.timeSinceLastShot = 0;
        
        // Subtract ammo
        this.ammo[this.currentWeaponType]--;
        this.updateAmmoUI();

        // Auto reload if empty
        if (this.ammo[this.currentWeaponType] <= 0) {
            this.reload();
        }

        // 1. MUZZLE POSITION
        // Calculate muzzle position using localToWorld to handle Scale/Rotation correctly
        const localMuzzle = this.currentWeaponType === 'pistol' ? 
            new THREE.Vector3(0, 0.1, -0.4) : // Pistol (Z-forward)
            new THREE.Vector3(0.85, 0.05, 0); // Rifle (+X forward tip)
        
        const muzzlePos = this.currentWeaponMesh.localToWorld(localMuzzle.clone());

        // 2. RAYCAST FROM CAMERA (Hitscan)
        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        
        const raycaster = new THREE.Raycaster(this.camera.position, camDir);
        raycaster.far = 1000;

        // Targets: All meshes except self
        const targets = [];
        const currentVehMesh = (this.characterController && this.characterController.vehicle) ? this.characterController.vehicle.mesh : null;
        
        this.scene.traverse(c => {
            if (c.isMesh && !this.isSelf(c) && c.visible) {
                if (this.isVehiclePart(c, currentVehMesh)) return;
                if (c.userData.type === 'bullet' || c.userData.type === 'impact_part') return;
                targets.push(c);
            }
        });

        // Add remote players
        if (this.remotePlayers) {
            this.remotePlayers.forEach(p => {
                const mesh = p.mesh || (p.isMesh ? p : null);
                if (mesh) mesh.traverse(c => { if (c.isMesh) targets.push(c); });
            });
        }

        const hits = raycaster.intersectObjects(targets, false);
        const targetPoint = hits.length > 0 ? hits[0].point : this.camera.position.clone().add(camDir.multiplyScalar(1000));

        // 3. VISUAL BULLET (OR PROJECTILE)
        const bulletDir = targetPoint.clone().sub(muzzlePos).normalize();
        
        if (this.currentWeaponType === 'bazooka') {
            // Spawn a Missile (Reusing TankShell logic since it does exactly what we want)
            // Play a rocket sound? We don't have one, but we can play tank shot sound.
            if (this.soundManager) this.soundManager.playTankShot();
            
            // Adjust muzzle pos for bazooka to be further forward
            muzzlePos.add(bulletDir.clone().multiplyScalar(2.0));
            
            const shell = new TankShell(this.scene, muzzlePos, bulletDir, 100.0, (pos, norm, obj) => {
                this.createExplosion(pos, 8.0); // Bigger explosion
                this.createImpact(pos, norm || new THREE.Vector3(0, 1, 0), 'spark', 15.0, obj); // ENORMOUS DECAL/HOLE (15.0 scale)

                this.applyAreaDamage(pos, 15.0, 1.0);
            });

            if (hits.length > 0) {
                const hit = hits[0];
                shell.hitPoint = hit.point;
                const worldNormal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
                shell.hitNormal = worldNormal;
                shell.hitObject = hit.object;
            } else {
                shell.hitPoint = targetPoint;
            }

            this.tankShells.push(shell); // We can reuse the tankShells array for update loop
            
            return; // Skip hitscan effects
        }

        const bullet = new Bullet(this.scene, muzzlePos, bulletDir, 350.0);
        this.bullets.push(bullet);

        // 4. IMPACT EFFECTS
        if (hits.length > 0) {
            const hit = hits[0];
            const normal = hit.face ? hit.face.normal.clone().applyQuaternion(hit.object.quaternion) : new THREE.Vector3(0, 1, 0);
            
            // Type of impact
            let type = 'spark';
            if (this.isRemotePlayer(hit.object)) type = 'blood';

            const impactScale = this.currentWeaponType === 'rifle' ? 2.5 : 1.0;
            this.createImpact(hit.point, normal, type, impactScale, hit.object);

            // Damage Vehicles
            const targetVeh = this.characterController.world.vehicleManager.findVehicleByMesh(hit.object);
            if (targetVeh) {
                const dmg = this.currentWeaponType === 'rifle' ? 0.2 : 0.05;
                this.characterController.world.vehicleManager.damageVehicle(targetVeh, dmg, hit.object);
            }



            // Hit Canister?
            const targetCanister = this.canisters.find(c => {
                let found = false;
                c.mesh.traverse(m => { if (m === hit.object) found = true; });
                return found;
            });
            if (targetCanister && !targetCanister.exploded) {
                this.explodeCanister(targetCanister);
            }

            // --- TRASH CAN DESTRUCTION ---
            let trashCan = null;
            let temp = hit.object;
            while(temp) {
                if (temp.userData && temp.userData.isTrashCan) {
                    trashCan = temp;
                    break;
                }
                temp = temp.parent;
            }

            if (trashCan) {
                // Rule: 5 pistol shots (dmg 1) or 1 rifle shot (dmg 5)
                const dmg = (this.currentWeaponType === 'pistol') ? 1 : 5;
                trashCan.userData.hp -= dmg;
                console.log(`Trash Can HP: ${trashCan.userData.hp}`);
                
                if (trashCan.userData.hp <= 0) {
                    // NO EXPLOSION for trash cans as per user request
                    if (trashCan.parent) trashCan.parent.remove(trashCan);
                    
                    // --- CRITICAL: PHYSICS CLEANUP ---
                    if (this.characterController) {
                        this.characterController.colliders = this.characterController.colliders.filter(c => c !== trashCan);
                        // Force immediate update of the physics system to remove the "ghost"
                        if (this.characterController.world) {
                            this.characterController.world.updateRemoteColliders();
                        }
                    }
                }
            }
            
            // Network Hit
            if (this.networkManager) {
                this.networkManager.sendHit(hit.point, type, impactScale);
            }
        }

        // 5. MUZZLE FLASH (Light)
        if (this.flashLight) {
            this.flashLight.position.copy(muzzlePos);
            this.flashLight.intensity = 5.0;
            setTimeout(() => { if (this.flashLight) this.flashLight.intensity = 0; }, 50);
        }

        // 6. NETWORK SYNC
        if (this.networkManager) {
            this.networkManager.sendShoot(muzzlePos, bulletDir, this.currentWeaponType);
        }

        // 7. AUDIO
        if (this.soundManager) {
            this.soundManager.playShoot(this.currentWeaponType);
        }
    }

    fireHeliGuns() {
        const now = Date.now();
        if (this.lastHeliGunTime && (now - this.lastHeliGunTime < 100)) return; // 10 rounds per second
        this.lastHeliGunTime = now;

        const v = this.characterController.vehicle;
        if (!v) return;

        // Spawns from side guns of UH-60 (approximate offsets)
        const leftGun = new THREE.Vector3(-1.5, 0.5, 2.0).applyQuaternion(v.mesh.quaternion).add(v.mesh.position);
        const rightGun = new THREE.Vector3(1.5, 0.5, 2.0).applyQuaternion(v.mesh.quaternion).add(v.mesh.position);
        const spawnPos = (Math.random() > 0.5) ? leftGun : rightGun;

        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);

        // Target point far away (2km)
        const targetPoint = this.camera.position.clone().add(camDir.clone().multiplyScalar(2000));
        const bulletDir = targetPoint.clone().sub(spawnPos).normalize();

        // Visual Bullet (LARGE as requested)
        const bullet = new Bullet(this.scene, spawnPos, bulletDir, 300.0);
        bullet.mesh.scale.set(3, 3, 1); // Make it thick
        bullet.maxDistance = 2000;
        this.bullets.push(bullet);

        this.flashLight.position.copy(spawnPos);
        this.flashLight.intensity = 5;
        setTimeout(() => { if (this.flashLight) this.flashLight.intensity = 0; }, 50);

        if (this.soundManager) this.soundManager.playShoot('rifle');

        // Instant Hitscan for gameplay
        const ray = new THREE.Raycaster(this.camera.position, camDir);
        ray.far = 2000;
        const targets = [];
        this.scene.traverse(c => {
            if (c.isMesh && !this.isSelf(c) && !this.isVehiclePart(c, v.mesh) && c.visible) {
                if (c.userData.type === 'bullet' || c.userData.type === 'impact_part') return;
                targets.push(c);
            }
        });
        const hits = ray.intersectObjects(targets, false);

        if (hits.length > 0) {
            const hit = hits[0];
            const worldNormal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
            this.createImpact(hit.point, worldNormal, 'spark', 2.0, hit.object);

            // Damage 
            const obj = hit.object;
            const targetVeh = this.characterController.world.vehicleManager.findVehicleByMesh(obj);
            if (targetVeh) this.characterController.world.vehicleManager.damageVehicle(targetVeh, 0.1, obj, true);


        }
    }

    fireHeliMissiles() {
        const now = Date.now();
        if (this.lastHeliMissileTime && (now - this.lastHeliMissileTime < 1000)) return; // 1 missile per second
        this.lastHeliMissileTime = now;

        const v = this.characterController.vehicle;
        if (!v) return;

        // Spawns from pylons - Offset further out to avoid self-hit from cockpit
        const leftPylon = new THREE.Vector3(-3.0, -0.5, 1.5).applyQuaternion(v.mesh.quaternion).add(v.mesh.position);
        const rightPylon = new THREE.Vector3(3.0, -0.5, 1.5).applyQuaternion(v.mesh.quaternion).add(v.mesh.position);
        const spawnPos = (this.missileToggle = !this.missileToggle) ? leftPylon : rightPylon;

        const camDir = new THREE.Vector3();
        this.camera.getWorldDirection(camDir);
        const targetPoint = this.camera.position.clone().add(camDir.clone().multiplyScalar(2000));

        // Raycast to find exact target
        const ray = new THREE.Raycaster(this.camera.position, camDir);
        ray.far = 2000;
        const targets = [];
        this.scene.traverse(c => {
            if (c.isMesh && !this.isSelf(c) && !this.isVehiclePart(c, v.mesh) && c.visible) {
                if (c.userData.type === 'bullet' || c.userData.type === 'impact_part') return;
                targets.push(c);
            }
        });
        const hits = ray.intersectObjects(targets, false);
        const hitPoint = hits.length > 0 ? hits[0].point : targetPoint;

        // Homing Target Detection (Lock-On)
        let lockedVehicle = null;

        if (hits.length > 0) {
            const hitObj = hits[0].object;
            lockedVehicle = this.characterController.world.vehicleManager.findVehicleByMesh(hitObj);
        }

        // If no direct hit, try to find a vehicle near the center of the screen ray
        if (!lockedVehicle) {
            const searchRay = new THREE.Raycaster(this.camera.position, camDir);
            const vehManager = this.characterController.world.vehicleManager;
            if (vehManager) {
                // Collect all colliders of vehicles
                const vehColliders = [];
                vehManager.vehicles.forEach(veh => {
                    if (veh.mesh !== v.mesh) vehColliders.push(veh.mesh);
                });

                // Add some tolerance (raycast against slightly larger bounding boxes or just check distance to ray)
                let bestDist = 15.0; // lock-on tolerance
                vehManager.vehicles.forEach(veh => {
                    if (veh.mesh === v.mesh) return;
                    const vehPos = veh.mesh.position.clone();
                    // Distance from point to line (ray)
                    const v1 = vehPos.clone().sub(this.camera.position);
                    const v2 = v1.clone().projectOnVector(camDir);
                    const distToRay = v1.sub(v2).length();

                    if (distToRay < bestDist) {
                        bestDist = distToRay;
                        lockedVehicle = veh;
                    }
                });
            }
        }

        const missileDir = hitPoint.clone().sub(spawnPos).normalize();
        const missile = new HeliMissile(this.scene, spawnPos, missileDir, 180.0, (pos, norm, obj) => {
            // Massive Impact
            this.createExplosion(pos, 8.0);
            this.createImpact(pos, norm, 'spark', 5.0, obj); // Very large scale

            // AREA DAMAGE (SPLASH DAMAGE)
            const splashRadius = 20.0; // Slightly larger for missiles
            const vehManager = this.characterController.world.vehicleManager;
            if (vehManager) {
                const affectedVehicles = new Set();
                const worldPos = new THREE.Vector3();
                
                this.scene.traverse(c => {
                    if (c.isMesh) {
                        c.getWorldPosition(worldPos);
                        if (worldPos.distanceTo(pos) < splashRadius) {
                            const targetVeh = vehManager.findVehicleByMesh(c);
                            if (targetVeh && !affectedVehicles.has(targetVeh) && targetVeh.mesh !== v.mesh) {
                                vehManager.damageVehicle(targetVeh, 1.0, c, true);
                                affectedVehicles.add(targetVeh);
                            }
                        }
                    }
                });
            }
        });

        if (lockedVehicle) {
            missile.targetVehicle = lockedVehicle;
            console.log("🔒 HELI MISSILE LOCKED ON TARGET!");
        }

        if (hits.length > 0) {
            missile.hitPoint = hits[0].point;
            missile.hitNormal = hits[0].face ? hits[0].face.normal.clone().applyQuaternion(hits[0].object.quaternion) : new THREE.Vector3(0, 1, 0);
            missile.hitObject = hits[0].object;
        } else {
            missile.hitPoint = targetPoint;
        }

        this.tankShells.push(missile); // Use same update loop

        if (this.soundManager) this.soundManager.playTankShot(); // Reuse heavy sound
    }

    createImpact(point, normal, type = 'spark', scale = 1.0) {
        const baseMat = type === 'blood' ? this._bloodMat : this._sparkMat;

        // 1. SPARKS / PARTICLES
        // Optimized: Reduced count and use shared material clones for independent fade
        const sparkCount = (type === 'blood' ? 5 : 8) * scale; 
        for (let i = 0; i < sparkCount; i++) {
            const pMat = baseMat.clone();
            const p = new THREE.Mesh(this._sparkGeom, pMat);
            p.userData.type = 'impact_part';
            p.position.copy(point);
            p.scale.setScalar(scale);
            this.scene.add(p);

            const vel = normal ? normal.clone() : new THREE.Vector3(0, 1, 0);
            vel.x += (Math.random() - 0.5) * 1.5;
            vel.y += (Math.random() - 0.5) * 1.5;
            vel.z += (Math.random() - 0.5) * 1.5;
            vel.normalize().multiplyScalar(Math.random() * 5 + 2);

            let gravity = -9.8;
            let time = 0;
            const startPos = p.position.clone();

            const animateParticle = () => {
                time += 0.03;
                p.position.x = startPos.x + vel.x * time;
                p.position.z = startPos.z + vel.z * time;
                p.position.y = startPos.y + vel.y * time + 0.5 * gravity * time * time;

                pMat.opacity -= 0.06;
                if (pMat.opacity > 0) {
                    requestAnimationFrame(animateParticle);
                } else {
                    this.scene.remove(p);
                    pMat.dispose();
                }
            };
            animateParticle();
        }

        // 2. PERMANENT BULLET HOLE (DECALS) - Now with 20s lifetime
        if (type !== 'blood' && normal) {
            const holeSize = 0.5 * scale;
            const holeGeom = new THREE.PlaneGeometry(holeSize, holeSize);

            const canvas = document.createElement('canvas');
            canvas.width = 64; canvas.height = 64;
            const ctx = canvas.getContext('2d');
            const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 25);
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(0.3, 'rgba(30,30,30,0.8)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);

            const texture = new THREE.CanvasTexture(canvas);
            const holeMat = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -4
            });

            if (type === 'scorch') {
                holeMat.color.setHex(0x111111);
            }

            const hole = new THREE.Mesh(holeGeom, holeMat);
            hole.userData.type = 'impact_part';
            
            // Initial positioning
            hole.position.copy(point).add(normal.clone().multiplyScalar(0.01));
            hole.lookAt(point.clone().add(normal));
            
            // Parenting logic: Follow the object!
            if (arguments[4] && arguments[4].isMesh) {
                const object = arguments[4];
                object.attach(hole);
            } else {
                this.scene.add(hole);
            }

            // Lifetime: fade out and remove after 20 seconds
            setTimeout(() => {
                let fadeTime = 0;
                const fadeAnim = () => {
                    fadeTime += 0.05;
                    hole.material.opacity -= 0.05;
                    if (hole.material.opacity > 0) {
                        requestAnimationFrame(fadeAnim);
                    } else {
                        if (hole.parent) hole.parent.remove(hole);
                        holeGeom.dispose();
                        holeMat.dispose();
                        texture.dispose();
                    }
                };
                fadeAnim();
            }, type === 'scorch' ? 60000 : 20000); // Scorch lasts 60s, holes 20s
        }

        // 3. SMOKE PUFFS (NEW)
        // Optimized: Fewer smoke puffs and use shared material clones
        const smokeCount = 1 * scale;
        for (let i = 0; i < smokeCount; i++) {
            const sMat = this._smokeMat.clone();
            const s = new THREE.Mesh(this._smokeGeom, sMat);
            s.userData.type = 'impact_part';
            s.position.copy(point);
            s.scale.setScalar(scale);
            this.scene.add(s);

            const vel = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 + 1, (Math.random() - 0.5) * 2);
            let time = 0;
            const anim = () => {
                time += 0.06;
                s.position.add(vel.clone().multiplyScalar(0.05));
                s.scale.multiplyScalar(1.05);
                sMat.opacity -= 0.02;
                if (sMat.opacity > 0) requestAnimationFrame(anim);
                else {
                    this.scene.remove(s);
                    sMat.dispose();
                }
            };
            anim();
        }
    }

    createExplosion(point, scale = 1.0) {
        // 1. Core Flash (Smaller & Faster)
        const flashGeom = new THREE.SphereGeometry(1.5 * scale, 8, 8);
        const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 1.0 });
        const flash = new THREE.Mesh(flashGeom, flashMat);
        flash.position.copy(point);
        this.scene.add(flash);

        // 2. Light Pulse (Reduced intensity/range)
        const light = new THREE.PointLight(0xffaa00, 20 * scale, 15 * scale);
        light.position.copy(point);
        this.scene.add(light);

        // Animate Flash and Light
        let time = 0;
        const anim = () => {
            time += 0.05;
            flash.scale.multiplyScalar(1.1);
            flash.material.opacity -= 0.1;
            light.intensity -= 2.0;

            if (flash.material.opacity > 0) requestAnimationFrame(anim);
            else {
                this.scene.remove(flash);
                this.scene.remove(light);
                flashGeom.dispose();
                flashMat.dispose();
            }
        };
        anim();

        // 3. Debris/Sparks
        this.createImpact(point, new THREE.Vector3(0, 1, 0), 'spark', scale * 2);

        // 4. PERMANENT SCORCH MARK (Burn)
        // Raycast down to find ground
        const ray = new THREE.Raycaster(point.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObjects(this.scene.children, true);
        const groundHit = hits.find(h => h.object.name === "AsphaltFloor" || h.object.name.toLowerCase().includes('city'));
        if (groundHit) {
            this.createImpact(groundHit.point, groundHit.face ? groundHit.face.normal.clone().transformDirection(groundHit.object.matrixWorld) : new THREE.Vector3(0, 1, 0), 'scorch', scale * 3.0, groundHit.object);
        }

        // 5. SHOCKWAVE (Push nearby objects)
        const radius = 15.0 * scale;
        const force = 40.0 * scale;
        const world = this.scene.userData.world;
        if (world && world.vehicleManager) {
            // Push Managed Vehicles
            world.vehicleManager.vehicles.forEach(v => {
                const dist = v.mesh.position.distanceTo(point);
                if (dist < radius && dist > 0.1) {
                    const dir = v.mesh.position.clone().sub(point).normalize();
                    const intensity = (1.0 - dist / radius) * force;
                    world.vehicleManager.pushVehicle(v, dir, intensity);
                }
            });

            // Push NPC Cars
            if (world.npcManager && world.npcManager.cars) {
                world.npcManager.cars.forEach(car => {
                    const dist = car.position.distanceTo(point);
                    if (dist < radius && dist > 0.1) {
                        const dir = car.position.clone().sub(point).normalize();
                        const intensity = (1.0 - dist / radius) * force;
                        world.vehicleManager.pushVehicleNPC(car, dir, intensity);
                    }
                });
            }

            // Push Clutter (Trash Cans, Canisters)
            if (world.clutterObjects) {
                world.clutterObjects.forEach(obj => {
                    const dist = obj.position.distanceTo(point);
                    if (dist < radius && dist > 0.1) {
                        const dir = obj.position.clone().sub(point).normalize();
                        const intensity = (1.0 - dist / radius) * force * 0.5; // Slightly less for clutter
                        if (!obj.userData.pushVelocity) obj.userData.pushVelocity = new THREE.Vector3();
                        obj.userData.pushVelocity.add(dir.multiplyScalar(intensity));
                    }
                });
            }
        }
    }

    isRemotePlayer(obj) {
        if (!obj || !this.remotePlayers) return false;
        for (const p of this.remotePlayers) {
            let temp = obj;
            while (temp) {
                if (temp === p.mesh || temp === p) return true;
                temp = temp.parent;
            }
        }
        return false;
    }

    update(dt) {
        this.updateRangeFinder();

        // Update Tank Shells
        for (let i = this.tankShells.length - 1; i >= 0; i--) {
            const shell = this.tankShells[i];
            shell.update(dt);
            if (!shell.alive) this.tankShells.splice(i, 1);
        }

        // Update Laser Sight
        if (this.laserActive && this.currentWeaponMesh && this.laserMesh.visible) {
            let start;
            
            // Check if we are in First Person or Aiming (ADS)
            const inFirstPerson = (this.characterController && this.characterController.cameraDistance < 0.8);
            const isAiming = (this.characterController && this.characterController.keys && this.characterController.keys.ads);
            
            if (inFirstPerson || isAiming) {
                // ADS Mode (Tricks the brain)
                const camPos = this.camera.position.clone();
                const camDir = new THREE.Vector3();
                this.camera.getWorldDirection(camDir);
                const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
                const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

                start = camPos.clone()
                    .add(camRight.multiplyScalar(0.25))
                    .add(camUp.multiplyScalar(-0.25))
                    .add(camDir.multiplyScalar(0.5));
            } else {
                // Hip Fire / 3rd Person
                // Corrected AWP/Rifle Muzzle: +X orientation, approx 0.85 local
                const localMuzzle = this.currentWeaponType === 'pistol' ? 
                    new THREE.Vector3(0, 0.1, -0.4) : 
                    new THREE.Vector3(0.85, 0.05, 0); // Muzzle at the tip of the barrel
                
                this.currentWeaponMesh.updateMatrixWorld(true);
                start = this.currentWeaponMesh.localToWorld(localMuzzle.clone());
            }

            const raycaster = new THREE.Raycaster();
            const direction = new THREE.Vector3();
            this.camera.getWorldDirection(direction);
            raycaster.set(this.camera.position, direction);
            raycaster.far = 1000;

            // PERFORMANCE: Use cached targets from updateRangeFinder instead of traverse
            const hits = raycaster.intersectObjects(this.raycastTargets, false);
            const end = new THREE.Vector3();
            if (hits.length > 0) end.copy(hits[0].point);
            else end.copy(this.camera.position).add(direction.multiplyScalar(100));

            const positions = this.laserMesh.geometry.attributes.position.array;
            positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
            positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
            this.laserMesh.geometry.attributes.position.needsUpdate = true;
            this.laserMesh.geometry.computeBoundingSphere();
        }

        if (!this.rightHandBone && this.character) {
            this.findHandBone();
            if (this.rightHandBone && !this.currentWeaponMesh) this.equip('pistol');
        }

        this.timeSinceLastShot += dt;
        
        // THROTTLE PERFORMANCE-HEAVY UPDATES
        this.rangeFinderThrottle++;
        if (this.rangeFinderThrottle % 5 === 0) {
            this.updateRangeFinder(); // This also updates raycastTargets
        }

        if (this.isFiring && this.currentWeaponType) {
            const rate = this.configs[this.currentWeaponType].fireRate || 0.5;
            if (this.timeSinceLastShot >= rate) this.shoot();
        }

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.update(dt);
            if (!b.active) this.bullets.splice(i, 1);
        }

        if (this.activeBullet && this.activeBullet.active) {
            const offset = this.activeBullet.direction.clone().multiplyScalar(-2.0).add(new THREE.Vector3(0, 0.5, 0));
            this.camera.position.copy(this.activeBullet.mesh.position).add(offset);
            this.camera.lookAt(this.activeBullet.mesh.position);
            this.bulletCamTimer -= dt;
            if (this.characterController) this.characterController.overrideCamera = true;
            if (this.bulletCamTimer <= 0) {
                this.activeBullet.speed = 50.0;
                this.activeBullet = null;
                if (this.characterController) this.characterController.overrideCamera = false;
            }
            if (this.characterController) {
                this.characterController.shakeCamera(0.2, 0.1);
            }
        } else if (this.characterController) {
            this.characterController.overrideCamera = false;
        }

        // 8. TACTICAL AR UPDATE (Tank only)
        const isTank = this.characterController && this.characterController.isDriving && this.characterController.vehicle && this.characterController.vehicle.type === 'tank';
        if (isTank && this.scene.userData.world && this.scene.userData.world.uiVisible) {
            this.arContainer.style.display = 'block';
            this.updateARTargets();
        } else {
            this.arContainer.style.display = 'none';
        }
    }

    updateARTargets() {
        const world = this.scene.userData.world;
        if (!world) return;

        // Collect all potential targets
        const potentialTargets = [];

        // 1. Remote Players
        if (this.remotePlayers) {
            this.remotePlayers.forEach(p => {
                if (p.mesh) potentialTargets.push({ pos: p.mesh.position, name: `PLR_${p.id.substring(0, 4)}`, type: 'PLAYER' });
            });
        }

        // 2. NPC Cars & Pedestrians
        if (world.npcManager) {
            if (world.npcManager.cars) {
                world.npcManager.cars.forEach((car, i) => {
                    potentialTargets.push({ pos: car.position, name: `VEH_${i}`, type: 'NPC' });
                });
            }
        }

        // 3. Vehicles
        if (world.vehicleManager && world.vehicleManager.vehicles) {
            world.vehicleManager.vehicles.forEach((v, i) => {
                if (v.mesh && v !== this.characterController.vehicle) {
                    potentialTargets.push({ pos: v.mesh.position, name: v.type.toUpperCase(), type: 'VEHICLE' });
                }
            });
        }

        // Update DOM elements
        const currentIds = new Set();
        potentialTargets.forEach(target => {
            const id = `${target.name}_${target.pos.x}_${target.pos.z}`;
            currentIds.add(id);

            // Re-identify NPC tanks in HUD
            let displayName = target.name;
            if (target.type === 'NPC' && world.vehicleManager && world.vehicleManager.isArmor) {
                // Find matching mesh in npcManager.cars
                const carIndex = parseInt(target.name.split('_')[1]);
                const carMesh = world.npcManager.cars[carIndex];
                if (carMesh && world.vehicleManager.isArmor(carMesh)) {
                    displayName = 'TANK';
                }
            }

            // Distance Check (only show targets within 150m)
            const dist = this.camera.position.distanceTo(target.pos);
            if (dist > 150) return;

            // Project to screen - WITH VERTICAL OFFSET
            // Offset world point upward (e.g. 5m for a tank/car) to put label ABOVE
            const vector = target.pos.clone().add(new THREE.Vector3(0, 4.0, 0));
            vector.project(this.camera);

            const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
            const y = (vector.y * -0.5 + 0.5) * window.innerHeight;

            // Only show if in front of camera
            if (vector.z > 0 && vector.z < 1) {
                let el = this.arMarkers.get(id);
                if (!el) {
                    el = document.createElement('div');
                    el.style.position = 'absolute';
                    el.style.padding = '4px';
                    el.style.border = '2px solid #00ffff';
                    el.style.color = '#00ffff';
                    el.style.fontFamily = 'monospace';
                    el.style.fontSize = '12px';
                    el.style.pointerEvents = 'none';
                    el.style.whiteSpace = 'nowrap';
                    el.style.boxShadow = '0 0 10px rgba(0,255,255,0.5)';
                    el.style.background = 'rgba(0, 50, 50, 0.4)'; // Subtle background
                    this.arContainer.appendChild(el);
                    this.arMarkers.set(id, el);
                }

                el.style.display = 'block';
                el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`; // Offset -100% Y to put it ABOVE point
                el.innerHTML = `<span style="font-weight:bold;">[</span> ${displayName} <span style="font-weight:bold;">]</span><br>${dist.toFixed(1)}m`;
            } else {
                const el = this.arMarkers.get(id);
                if (el) el.style.display = 'none';
            }
        });

        // Cleanup old markers
        for (const [id, el] of this.arMarkers.entries()) {
            if (!currentIds.has(id)) {
                el.remove();
                this.arMarkers.delete(id);
            }
        }
    }



    reload() {
        if (!this.currentWeaponType || this.isReloading) return;
        
        if (this.currentWeaponType === 'bazooka') {
            console.log("Bazooka must be reloaded by picking up ammo on the map!");
            return; // Bazooka uses pickups, no manual reload
        }
        
        // Don't reload if already full
        if (this.ammo[this.currentWeaponType] === this.maxAmmo[this.currentWeaponType]) return;

        this.isReloading = true;
        this.isFiring = false;
        
        console.log("WeaponManager: Reloading...");
        this.updateAmmoUI(); // Shows "RELOADING..."

        if (this.soundManager) this.soundManager.playReload();

        // Lock shooting for 2 seconds (reload duration)
        setTimeout(() => {
            if (this.currentWeaponType) {
                // Refill ammo
                this.ammo[this.currentWeaponType] = this.maxAmmo[this.currentWeaponType];
            }
            this.isReloading = false;
            this.updateAmmoUI();
            console.log("WeaponManager: Reload complete.");
        }, 2000);
    }

    explodeCanister(canister) {
        if (canister.exploded) return;
        canister.exploded = true;

        const pos = canister.mesh.position.clone();
        // --- CRITICAL: PHYSICS CLEANUP ---
        if (this.characterController) {
            this.characterController.colliders = this.characterController.colliders.filter(c => c !== canister.mesh);
            // Force immediate update of the physics system to remove the "ghost"
            if (this.characterController.world) {
                this.characterController.world.updateRemoteColliders();
            }
        }

        // Visual & Audio
        this.createExplosion(pos, 6.0); // Normal explosion
        if (this.soundManager) this.soundManager.playTankShot();

        // Area Damage (Normal radius)
        this.applyAreaDamage(pos, 8.0, 1.0);

        // Remove mesh
        this.scene.remove(canister.mesh);
        this.canisters = this.canisters.filter(c => c !== canister);
    }
}
