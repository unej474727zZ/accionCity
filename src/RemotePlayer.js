import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Bullet } from './Bullet.js';

export class RemotePlayer {
    constructor(scene, assets, id, initialData, world) {
        this.scene = scene;
        this.assets = assets;
        this.id = id;
        this.world = world;

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.state = 'idle';
        this.weaponType = null;
        this.weaponMesh = null;
        this.rightHandBone = null;
        this.bullets = [];
        this.pitch = 0;
        this.headBone = null;
        this.helmetMesh = null;
        this.laserActive = true;
        this.laserMesh = this.createLaser();
        this.raycaster = new THREE.Raycaster();

        this.init(initialData);
    }

    init(data) {
        const idleAsset = this.assets['idle'];
        if (idleAsset) {
            // USE SKELETONUTILS CLONE (The proper way for SkinnedMeshes)
            this.mesh = SkeletonUtils.clone(idleAsset.scene);
            this.mesh.userData.id = this.id;
            this.mesh.name = `RemotePlayer_${this.id}`;
            this.playerColor = data.color || 0x00ffaa;
            this.scene.add(this.mesh);

            // ANIMATION SETUP
            this.mixer = new THREE.AnimationMixer(this.mesh);

            const loadAnim = (name, assetKey) => {
                const asset = this.assets[assetKey];
                if (asset && asset.animations && asset.animations.length > 0) {
                    this.animations[name] = asset.animations[0];
                }
            };

            const upperBodyBones = ['Spine', 'Neck', 'Head', 'Shoulder', 'Arm', 'Hand', 'ForeArm'];
            const createMask = (name, assetKey) => {
                const asset = this.assets[assetKey];
                const rawClip = asset && asset.animations && asset.animations.length > 0 ? asset.animations[0] : null;
                if (rawClip) {
                    const newTracks = [];
                    rawClip.tracks.forEach(track => {
                        const boneName = track.name.split('.')[0];
                        if (upperBodyBones.some(b => boneName.includes(b))) newTracks.push(track);
                    });
                    this.animations[name] = new THREE.AnimationClip(name, rawClip.duration, newTracks);
                } else {
                    loadAnim(name, assetKey);
                }
            };

            loadAnim('idle', 'idle');
            loadAnim('walk', 'walk');
            loadAnim('run', 'run');
            loadAnim('backward', 'backward');
            loadAnim('jump', 'jump');
            createMask('firing', 'firing');
            createMask('shooting', 'shooting');

            this.playAnimation('idle');

            // Find Hand Bone (Identical to WeaponManager)
            this.findHandBone();
            this.findHeadBone();

            // SYNC COLOR (Keep textures, add glow)
            this.tintMesh(this.mesh, data.color || 0x00ffaa);

            // NAME TAG
            this.createNameTag(data.name || `Player ${this.id.substr(0, 4)}`);

            this.scene.add(this.laserMesh);

            // HITBOX
            const hitGeom = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8);
            const hitMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthWrite: false });
            const hitBox = new THREE.Mesh(hitGeom, hitMat);
            hitBox.name = "RemotePlayerHitBox";
            hitBox.position.y = 0.9;
            this.mesh.add(hitBox);

            this.updateState(data);
        }
    }

    findHandBone() {
        if (!this.mesh) return;
        let bestBone = null;
        this.mesh.traverse((child) => {
            if (child.isBone) {
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
            console.log(`RemotePlayer ${this.id}: Bone found: ${bestBone.name}`);
        }
    }

    findHeadBone() {
        if (!this.mesh) return;
        let bestBone = null;
        this.mesh.traverse((child) => {
            if (child.isBone) {
                const name = child.name.toLowerCase();
                if (name.includes('head') && !name.includes('neck') && !name.includes('top')) {
                    bestBone = child;
                }
            }
        });
        if (bestBone) {
            this.headBone = bestBone;
        }
    }

    tintMesh(mesh, colorHex) {
        mesh.traverse((child) => {
            child.visible = true;
            if (child.isMesh) {
                child.frustumCulled = false;
                if (child.material) {
                    child.material = child.material.clone();
                    child.material.transparent = false;
                    child.material.opacity = 1.0;
                    child.material.color.set(colorHex);
                    if (child.material.emissive) {
                        child.material.emissive.set(colorHex);
                        child.material.emissiveIntensity = 0.5;
                    }
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    createNameTag(name) {
        this.nameTag = document.createElement('div');
        this.nameTag.style.position = 'absolute';

        // Usamos Three.js para asegurarnos de que el color sea IDENTICO al del avatar
        const color = new THREE.Color(this.playerColor || 0x00ffaa);
        this.nameTag.style.color = color.getStyle(); // Retorna "rgb(r,g,b)" exacto

        this.nameTag.style.background = 'none';
        this.nameTag.style.padding = '0';
        this.nameTag.style.fontSize = '16px';
        this.nameTag.style.pointerEvents = 'none';
        this.nameTag.style.userSelect = 'none';
        this.nameTag.innerText = name;
        document.body.appendChild(this.nameTag);
    }

    setWeapon(type) {
        if (this.weaponType === type && this.weaponMesh) return;
        this.weaponType = type;

        // Clean up
        if (this.weaponMesh) {
            if (this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
            this.weaponMesh = null;
        }

        if (!type) return;

        const asset = this.assets[type];
        if (asset) {
            this.weaponMesh = asset.scene.clone();

            // CONFIGS (Must match WeaponManager.js)
            if (type === 'pistol') {
                this.weaponMesh.scale.set(15.0, 15.0, 15.0);
                this.weaponMesh.position.set(0.05, -0.2, 0.4);
                this.weaponMesh.rotation.set(0, Math.PI / 2, 0);
            } else if (type === 'rifle') {
                this.weaponMesh.scale.set(250.0, 250.0, 250.0);
                this.weaponMesh.position.set(0, -0.4, 0.5);
                this.weaponMesh.rotation.set(2.77, 5.74, -64.00); // Matches User "Perfect" setting
            } else if (type === 'bazooka') {
                this.weaponMesh.scale.set(15.0, 15.0, 15.0);
                this.weaponMesh.position.set(0.5, 0.4, 0.3);
                this.weaponMesh.rotation.set(0, Math.PI, 0);
            }

            if (this.rightHandBone) {
                this.rightHandBone.add(this.weaponMesh);
            } else {
                this.scene.add(this.weaponMesh); // Fallback
            }
        }
    }

    updateState(data) {
        if (!this.mesh || data.x === undefined) return;
        this.mesh.position.set(data.x, data.y, data.z);
        this.yaw = data.yaw || 0;
        this.mesh.rotation.y = this.yaw; // Removed + Math.PI to match local player and asset default (+Z)
        this.pitch = data.pitch || 0;

        if (this.state !== data.state) {
            this.state = data.state;
            this.playAnimation(this.state);
        }

        if (data.weaponType !== this.weaponType) {
            this.setWeapon(data.weaponType);
        }

        // SYNC FIRING STANCE (Rifle UP)
        const isStance = (this.state === 'rifle' || this.state === 'pistol');
        const isFiring = data.firing || isStance;
        this.setFiring(isFiring);

        // --- HELMET SYNC ---
        if (data.vehicleType === 'motorcycle') {
            if (!this.helmetMesh) {
                this.helmetMesh = this.createVRHelmet();
            }
            if (this.headBone && this.helmetMesh && !this.helmetMesh.parent) {
                this.headBone.add(this.helmetMesh);
                
                // PROGRAMMATIC SCALE COMPENSATION FOR MIXAMO ARMATURE
                this.headBone.updateMatrixWorld(true);
                const worldScale = new THREE.Vector3();
                this.headBone.getWorldScale(worldScale);
                
                if (worldScale.x !== 0 && worldScale.y !== 0 && worldScale.z !== 0) {
                    this.helmetMesh.scale.set(
                        1.0 / worldScale.x,
                        1.0 / worldScale.y,
                        1.0 / worldScale.z
                    );
                } else {
                    this.helmetMesh.scale.set(120, 120, 120); // Fallback standard Mixamo compensation
                }
                
                // Position and rotation offsets must also be adjusted for the parent scale:
                const scaleCompY = worldScale.y !== 0 ? 1.0 / worldScale.y : 120;
                const scaleCompZ = worldScale.z !== 0 ? 1.0 / worldScale.z : 120;
                this.helmetMesh.position.set(0, 0.1 * scaleCompY, 0.03 * scaleCompZ);
                this.helmetMesh.rotation.set(0, 0, 0);

                this.helmetMesh.visible = true;
            }
        } else {
            if (this.helmetMesh) {
                this.helmetMesh.visible = false;
                if (this.helmetMesh.parent) this.helmetMesh.parent.remove(this.helmetMesh);
            }
        }
    }

    setFiring(isActive) {
        if (!this.mixer || !this.weaponType) return;

        const isRifle = (this.weaponType === 'rifle');
        const targetClipName = isRifle ? 'firing' : 'shooting';
        const otherClipName = isRifle ? 'shooting' : 'firing';

        const targetClip = this.animations[targetClipName];
        if (!targetClip) return;
        const targetAction = this.mixer.clipAction(targetClip);

        // Clean up other mask
        const otherClip = this.animations[otherClipName];
        if (otherClip) {
            const otherAction = this.mixer.clipAction(otherClip);
            if (otherAction.isRunning()) otherAction.fadeOut(0.2);
        }

        if (isActive) {
            if (!targetAction.isRunning() || targetAction.getEffectiveWeight() < 0.1) {
                targetAction.reset();
                targetAction.enabled = true;
                targetAction.setLoop(THREE.LoopRepeat);
                targetAction.setEffectiveWeight(1.0); // Corrected from 50.0 to prevent mesh glitching
                targetAction.play();
                targetAction.fadeIn(0.2);
            }
        } else {
            if (targetAction.isRunning()) {
                targetAction.fadeOut(0.2);
            }
        }
    }

    playAnimation(name) {
        // Fallbacks for stances to base idle
        let actualAnimName = name;
        if (name === 'rifle' || name === 'pistol') actualAnimName = 'idle';

        const clip = this.animations[actualAnimName] || this.animations['idle'];
        if (!clip || !this.mixer) return;

        const action = this.mixer.clipAction(clip);
        if (this.currentAction === action) return;

        if (this.currentAction) this.currentAction.fadeOut(0.2);
        action.reset().fadeIn(0.2).play();
        this.currentAction = action;
    }

    shoot(origin, direction, weaponType) {
        // Tracer effect
        const start = new THREE.Vector3(origin.x, origin.y, origin.z);
        const dir = new THREE.Vector3(direction.x, direction.y, direction.z);

        const bullet = new Bullet(this.scene, start, dir, 150);
        this.bullets.push(bullet);

        // --- MUZZLE FLASH VISUAL ---
        const flashGeom = new THREE.PlaneGeometry(0.5, 0.5);
        const flashMat = new THREE.MeshBasicMaterial({
            color: 0xffcc00,
            transparent: true,
            opacity: 1,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        });
        const flash = new THREE.Mesh(flashGeom, flashMat);
        flash.position.copy(start);
        flash.lookAt(this.world.camera.position); // Always face the observer
        this.scene.add(flash);

        // Flash Light (Muzzle)
        const light = new THREE.PointLight(0xffaa00, 10, 10);
        light.position.copy(start);
        this.scene.add(light);

        // Cleanup flash
        setTimeout(() => {
            if (this.scene) {
                this.scene.remove(flash);
                this.scene.remove(light);
            }
        }, 100); // 100ms for better visibility
    }

    update(dt, camera) {
        if (this.mixer) this.mixer.update(dt);

        // --- APPLY PITCH TO BONES (Aiming up/down) ---
        if (this.mesh) {
            this.mesh.traverse(child => {
                // Repartimos la inclinación para que no parezca un avestruz (Look natural)
                if (child.isBone) {
                    if (child.name.includes('Neck') || child.name.includes('Head')) {
                        // Facing +Z, negative X rotation tilts backwards (UP)
                        // Just the head/neck as requested
                        child.rotation.x = -this.pitch;
                    }
                }
            });
        }

        // --- UPDATE REMOTE LASER ---
        if (this.laserMesh && this.weaponMesh && this.weaponType) {
            const isFiringOrStance = (this.state === 'rifle' || this.state === 'pistol' || this.firing);
            this.laserMesh.visible = isFiringOrStance;

            if (this.laserMesh.visible) {
                // Muzzle position logic (same as WeaponManager)
                const localMuzzle = this.weaponType === 'pistol' ?
                    new THREE.Vector3(0, 0.1, -0.4) :
                    new THREE.Vector3(0.85, 0.05, 0);

                this.weaponMesh.updateMatrixWorld(true);
                const start = this.weaponMesh.localToWorld(localMuzzle.clone());

                // Direction from pitch/yaw
                const dir = new THREE.Vector3(0, 0, 1); // Face +Z by default for yaw=0
                // Sincronizamos con el eje de mira del jugador (yaw puro)
                const playerRot = new THREE.Euler(-this.pitch, this.yaw, 0, 'YXZ');
                dir.applyEuler(playerRot);

                const end = start.clone().add(dir.clone().multiplyScalar(100));

                // RAYCAST COLLISION (Laser stopping at walls/players)
                let hitPoint = end;
                if (this.world) {
                    this.raycaster.set(start, dir);
                    this.raycaster.far = 100;

                    // Get all possible targets: Buildings + Local Player
                    const targets = [];
                    if (this.world.character && this.world.character.mesh) targets.push(this.world.character.mesh);
                    if (this.world.character && this.world.character.colliders) targets.push(...this.world.character.colliders);

                    // Also other remote players (optional but better)
                    for (let rid in this.world.remotePlayers) {
                        if (rid !== this.id && this.world.remotePlayers[rid].mesh) {
                            targets.push(this.world.remotePlayers[rid].mesh);
                        }
                    }

                    const intersects = this.raycaster.intersectObjects(targets, true);
                    if (intersects.length > 0) {
                        hitPoint = intersects[0].point;
                    }
                }

                const positions = this.laserMesh.geometry.attributes.position.array;
                positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
                positions[3] = hitPoint.x; positions[4] = hitPoint.y; positions[5] = hitPoint.z;
                this.laserMesh.geometry.attributes.position.needsUpdate = true;
                this.laserMesh.geometry.computeBoundingSphere();
            }
        }

        for (let i = this.bullets.length - 1; i >= 0; i--) {
            this.bullets[i].update(dt);
            if (!this.bullets[i].active) this.bullets.splice(i, 1);
        }

        // NameTag positioning
        if (this.nameTag && this.mesh && camera) {
            const pos = this.mesh.position.clone().add(new THREE.Vector3(0, 2.2, 0));
            pos.project(camera);
            if (pos.z < 1) {
                this.nameTag.style.display = 'block';
                this.nameTag.style.left = `${(pos.x * 0.5 + 0.5) * window.innerWidth}px`;
                this.nameTag.style.top = `${(-pos.y * 0.5 + 0.5) * window.innerHeight}px`;
                this.nameTag.style.transform = 'translate(-50%, -100%)';
            } else {
                this.nameTag.style.display = 'none';
            }
        }
    }

    dispose() {
        if (this.nameTag) this.nameTag.remove();
        if (this.mesh) this.scene.remove(this.mesh);
        if (this.laserMesh) this.scene.remove(this.laserMesh);
        this.bullets.forEach(b => b.destroy());
    }

    createVRHelmet() {
        const helmet = new THREE.Group();
        helmet.name = "VRHelmet";

        // 1. Helmet Casing (Sphere cut or squashed)
        const casingGeom = new THREE.SphereGeometry(0.24, 16, 16);
        casingGeom.scale(1.0, 1.05, 1.15); // Squashed to look aerodynamic
        const casingMat = new THREE.MeshStandardMaterial({
            color: 0x1b1f22, // Sleek matte carbon dark grey
            roughness: 0.5,
            metalness: 0.8
        });
        const casing = new THREE.Mesh(casingGeom, casingMat);
        helmet.add(casing);

        // 2. Neon Visor (Glowing sleek curved cylinder/sphere piece)
        const visorGeom = new THREE.SphereGeometry(0.21, 16, 16, 0, Math.PI, 0, Math.PI / 2);
        const visorMat = new THREE.MeshBasicMaterial({
            color: 0x00f3ff, // High vibrant cyber cyan
            transparent: true,
            opacity: 0.85,
            blending: THREE.AdditiveBlending
        });
        const visor = new THREE.Mesh(visorGeom, visorMat);
        visor.scale.set(1.05, 0.8, 1.16);
        visor.position.set(0, 0.02, 0.04);
        visor.rotation.x = Math.PI / 6; // Angled down slightly
        helmet.add(visor);

        // 3. Side Holographic Projector Cylinders (Left & Right)
        const projectorGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8);
        projectorGeom.rotateZ(Math.PI / 2);
        const projectorMat = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.9, roughness: 0.2 });
        
        const rightProjector = new THREE.Mesh(projectorGeom, projectorMat);
        rightProjector.position.set(0.22, 0, 0);
        helmet.add(rightProjector);

        const leftProjector = new THREE.Mesh(projectorGeom, projectorMat);
        leftProjector.position.set(-0.22, 0, 0);
        helmet.add(leftProjector);

        // 4. Side LED Lights (Cyan Glowing rings or points)
        const ledGeom = new THREE.SphereGeometry(0.015, 8, 8);
        const ledMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
        
        const rightLed = new THREE.Mesh(ledGeom, ledMat);
        rightLed.position.set(0.23, 0, 0.05);
        helmet.add(rightLed);

        const leftLed = new THREE.Mesh(ledGeom, ledMat);
        leftLed.position.set(-0.23, 0, 0.05);
        helmet.add(leftLed);

        // 5. Back Battery / HUD Processor (Box at the back)
        const packGeom = new THREE.BoxGeometry(0.12, 0.12, 0.08);
        const packMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: 0.6 });
        const backPack = new THREE.Mesh(packGeom, packMat);
        backPack.position.set(0, 0, -0.22);
        helmet.add(backPack);

        // Flashing red status LED on the backpack
        const statusLedGeom = new THREE.SphereGeometry(0.01, 8, 8);
        const statusLedMat = new THREE.MeshBasicMaterial({ color: 0xff0033 });
        const statusLed = new THREE.Mesh(statusLedGeom, statusLedMat);
        statusLed.position.set(0, 0.04, -0.26);
        helmet.add(statusLed);

        // Adjust position & rotation offsets to fit Mixamo Head bone perfectly
        helmet.position.set(0, 0.1, 0.03); // Slightly up and forward relative to Head bone center
        helmet.rotation.set(0, 0, 0); // Align forward with avatar look direction

        return helmet;
    }

    createLaser() {
        const laserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
        const laserMesh = new THREE.Line(laserGeom, laserMat);
        laserMesh.frustumCulled = false;
        laserMesh.visible = false;
        return laserMesh;
    }
}
