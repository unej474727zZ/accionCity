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
        if (!this.mesh) return;
        this.mesh.position.set(data.x, data.y, data.z);
        this.mesh.rotation.y = data.yaw + Math.PI; // Corrected field name to 'yaw'
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
                // USAMOS SPINE2 O SPINE PARA LA INCLINACION PRINCIPAL
                if (child.isBone && child.name.includes('Spine')) {
                    child.rotation.x = -this.pitch; // Aplicamos el pitch total al tronco
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
                const dir = new THREE.Vector3(0, 0, -1);
                // Correct for player rotation
                const playerRot = new THREE.Euler(-this.pitch, this.mesh.rotation.y + Math.PI, 0, 'YXZ');
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

    createLaser() {
        const laserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
        const laserMesh = new THREE.Line(laserGeom, laserMat);
        laserMesh.frustumCulled = false;
        laserMesh.visible = false;
        return laserMesh;
    }
}
