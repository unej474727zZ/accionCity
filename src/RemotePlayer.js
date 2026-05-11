import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Bullet } from './Bullet.js';

export class RemotePlayer {
    constructor(scene, assets, id, initialData) {
        this.scene = scene;
        this.assets = assets;
        this.id = id;

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.state = 'idle';
        this.weaponType = null;
        this.weaponMesh = null;
        this.rightHandBone = null;
        this.bullets = [];

        this.init(initialData);
    }

    init(data) {
        const idleAsset = this.assets['idle'];
        if (idleAsset) {
            // CLONE MESH (SkeletonUtils is safer for bones)
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

            loadAnim('idle', 'idle');
            loadAnim('walk', 'walk');
            loadAnim('run', 'run');
            loadAnim('backward', 'backward');
            loadAnim('jump', 'jump');
            loadAnim('firing', 'firing');
            loadAnim('shooting', 'shooting');

            this.playAnimation('idle');

            // Find Hand Bone (Identical to WeaponManager)
            this.findHandBone();

            // SYNC COLOR (Keep textures, add glow)
            this.tintMesh(this.mesh, data.color || 0x00ffaa);

            // NAME TAG
            this.createNameTag(data.name || `Player ${this.id.substr(0, 4)}`);

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
            if (child.isMesh) {
                child.frustumCulled = false; // Prevent flickering
                if (child.material) {
                    child.material = child.material.clone();
                    // Preserve texture, add emissive tint for identification
                    // 1. Set Base Color (Using .set for string compatibility)
                    child.material.color.set(colorHex);

                    // 2. Add Emissive (Glow) to prevent being pitch black in shadows
                    if (child.material.emissive) {
                        child.material.emissive.set(colorHex);
                        child.material.emissiveIntensity = 0.6;
                    }
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
        this.mesh.rotation.y = data.rot + Math.PI;

        if (this.state !== data.state) {
            this.state = data.state;
            this.playAnimation(this.state);
        }

        if (data.weaponType !== this.weaponType) {
            this.setWeapon(data.weaponType);
        }
    }

    playAnimation(name) {
        const clip = this.animations[name] || this.animations['idle'];
        if (!clip || !this.mixer) return;
        
        const action = this.mixer.clipAction(clip);
        if (this.currentAction === action) return;

        if (this.currentAction) this.currentAction.fadeOut(0.2);
        action.reset().fadeIn(0.2).play();
        this.currentAction = action;
    }

    shoot(origin, direction, weaponType) {
        // Tracer and light effect
        const start = new THREE.Vector3(origin.x, origin.y, origin.z);
        const dir = new THREE.Vector3(direction.x, direction.y, direction.z);
        
        const bullet = new Bullet(this.scene, start, dir, 150);
        this.bullets.push(bullet);

        // One-shot shoot animation
        const anim = (this.state === 'idle') ? 'firing' : 'shooting';
        const clip = this.animations[anim];
        if (clip) {
            const action = this.mixer.clipAction(clip);
            action.setLoop(THREE.LoopOnce);
            action.reset().play();
        }
    }

    update(dt, camera) {
        if (this.mixer) this.mixer.update(dt);

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
        this.bullets.forEach(b => b.destroy());
    }
}
