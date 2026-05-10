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

        this.state = 'idle';
        this.weaponType = null; // Default: No weapon
        this.weaponMesh = null;

        this.init(initialData);
    }

    init(data) {
        const idleAsset = this.assets['idle'];
        if (idleAsset) {
            // CLONE MESH
            this.mesh = SkeletonUtils.clone(idleAsset.scene);
            this.mesh.userData.id = this.id;
            this.mesh.name = `RemotePlayer_${this.id}`;
            this.scene.add(this.mesh);

            // ANIMATION SETUP
            this.mixer = new THREE.AnimationMixer(this.mesh);
            this.animations = {};

            const loadAnim = (name, assetName) => {
                if (this.assets[assetName] && this.assets[assetName].animations) {
                    this.animations[name] = this.assets[assetName].animations[0];
                }
            };

            loadAnim('idle', 'idle');
            loadAnim('walk', 'walk'); // Corrected key
            loadAnim('run', 'run');   // Corrected key
            loadAnim('backward', 'backward');
            loadAnim('jump', 'jump');
            loadAnim('firing', 'firing');
            loadAnim('shooting', 'shooting');

            // Start Idle
            this.playAnimation('idle');

            // TINT MESH (Using Color assigned by Server)
            this.tintMesh(this.mesh, data.color || 0x00ffaa);

            // NAME TAG
            this.createNameTag(data.name || `Player ${this.id.substr(0, 4)}`);

            // HITBOX (Invisible but Raycastable)
            const hitGeom = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8);
            const hitMat = new THREE.MeshBasicMaterial({
                color: 0xff0000,
                transparent: true,
                opacity: 0,
                // Crucial for Night Vision compatibility:
                depthWrite: false,
                colorWrite: false // Makes it truly invisible but keeps object active
            });
            const hitBox = new THREE.Mesh(hitGeom, hitMat);
            hitBox.name = "RemotePlayerHitBox";
            hitBox.position.y = 0.9;
            this.mesh.add(hitBox);

            // SYNC WEAPON
            if (data.weaponType) {
                this.setWeapon(data.weaponType);
            }
        }
    }

    // ... (rest of class)

    // ... methods merged ...
    tintMesh(mesh, colorHex) {
        mesh.traverse((child) => {
            if (child.isMesh) {
                // Ensure raycasting works on skinned meshes
                child.frustumCulled = false;
                if (child.geometry) {
                    child.geometry.computeBoundingBox();
                    child.geometry.computeBoundingSphere();
                }

                if (child.material) {
                    // Clone material to avoid affecting local player
                    child.material = child.material.clone();

                    // 1. Set Base Color
                    child.material.color.set(colorHex);

                    // 2. Add Emissive (Glow) to prevent being pitch black in shadows
                    // Use the same color but dimmer
                    if (child.material.emissive) {
                        child.material.emissive.set(colorHex);
                        child.material.emissiveIntensity = 0.4; // Valid glow
                    }
                }
            }
        });
    }

    createNameTag(name) {
        // Create Name Tag
        this.nameTag = document.createElement('div');
        this.nameTag.style.position = 'absolute';
        this.nameTag.style.color = 'white';
        this.nameTag.style.background = 'rgba(0, 0, 0, 0.5)';
        this.nameTag.style.padding = '2px 5px';
        this.nameTag.style.borderRadius = '3px';
        this.nameTag.style.fontSize = '12px';
        this.nameTag.style.pointerEvents = 'none'; // Click through
        this.nameTag.style.userSelect = 'none';
        this.nameTag.innerText = name || "Player";
        document.body.appendChild(this.nameTag);
    }

    updateState(data) {
        if (!this.mesh) return;

        this.mesh.position.set(data.x, data.y, data.z);
        this.mesh.rotation.y = data.rot + Math.PI; 

        if (this.state !== data.state) {
            this.state = data.state;
            this.playAnimation(this.state);
        }

        // SYNC WEAPON IN REAL-TIME
        if (data.weaponType && data.weaponType !== this.weaponType) {
            this.setWeapon(data.weaponType);
        }
    }

    update(dt, camera) {
        if (this.mixer) this.mixer.update(dt);

        // Update Bullets
        if (this.bullets) {
            for (let i = this.bullets.length - 1; i >= 0; i--) {
                const b = this.bullets[i];
                b.update(dt);
                if (!b.active) {
                    this.bullets.splice(i, 1);
                }
            }
        }

        // Update Name Tag Position
        if (this.nameTag && this.mesh && camera) {
            const headPos = this.mesh.position.clone().add(new THREE.Vector3(0, 2.0, 0)); // Above head
            headPos.project(camera);

            const x = (headPos.x * .5 + .5) * window.innerWidth;
            const y = (-(headPos.y * .5) + .5) * window.innerHeight;

            // Simple check if in front of camera
            if (headPos.z < 1) {
                this.nameTag.style.display = 'block';
                this.nameTag.style.left = `${x}px`;
                this.nameTag.style.top = `${y}px`;
                this.nameTag.style.transform = 'translate(-50%, -100%)';
            } else {
                this.nameTag.style.display = 'none';
            }
        }
    }

    shoot(origin, direction, weaponType) {
        if (!origin || !direction) return;

        const start = new THREE.Vector3(origin.x, origin.y, origin.z);
        const dir = new THREE.Vector3(direction.x, direction.y, direction.z);

        // Flash Light
        const light = new THREE.PointLight(0xffaa00, 10, 10);
        light.position.copy(start);
        this.scene.add(light);
        setTimeout(() => this.scene.remove(light), 80);

        // Tracer Bullet
        const bullet = new Bullet(this.scene, start, dir, 120.0);
        if (!this.bullets) this.bullets = [];
        this.bullets.push(bullet);

        // AUDIO
        if (this.scene.userData && this.scene.userData.world && this.scene.userData.world.soundManager) {
            this.scene.userData.world.soundManager.playShoot(weaponType || this.weaponType);
        }

        // ANIMATION (Visual Feedback)
        const animName = (this.state === 'idle') ? 'firing' : 'shooting';
        this.playOneShotAnimation(animName);
    }

    playOneShotAnimation(name) {
        const clip = this.animations[name];
        if (!clip) return;

        // Create a new action for this one-shot event
        const action = this.mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.reset();
        action.setEffectiveWeight(10.0); // Ensure it overrides other animations
        action.fadeIn(0.1);
        action.play();

        // Listen for finish to fade out
        const onFinish = (e) => {
            if (e.action === action) {
                action.fadeOut(0.2);
                this.mixer.removeEventListener('finished', onFinish);
            }
        };
        this.mixer.addEventListener('finished', onFinish);
    }

    playAnimation(name) {
        if (name === 'backward') name = 'walk';
        const clip = this.animations[name];
        if (!clip) return;

        if (this.currentAction) {
            this.currentAction.fadeOut(0.2);
        }

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.fadeIn(0.2);
        action.play();
        this.currentAction = action;
    }

    setWeapon(type) {
        this.weaponType = type;

        // Remove old weapon mesh
        if (this.weaponMesh) {
            if (this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
            else this.scene.remove(this.weaponMesh);
            this.weaponMesh = null;
        }

        let weaponAsset = null;
        let scale = 1.0;
        let rot = new THREE.Euler(0, 0, 0);
        let pos = new THREE.Vector3(0, 0, 0);

        if (type === 'pistol') {
            weaponAsset = this.assets['pistol'];
            scale = 15.0;
            pos.set(0, -0.2, 0.5);
            rot.set(Math.PI, Math.PI / 2, 0);
        } else if (type === 'rifle') {
            weaponAsset = this.assets['rifle'];
            scale = 250.0;
            pos.set(0, -0.4, 0.5);
            rot.set(2.77, 5.74, -64.00);
        }

        if (weaponAsset && weaponAsset.scene) {
            this.weaponMesh = weaponAsset.scene.clone();
            this.weaponMesh.scale.set(scale, scale, scale);
            this.weaponMesh.position.copy(pos);
            this.weaponMesh.rotation.copy(rot);

            // Find Right Hand Bone (Robust method from WeaponManager)
            let rightHand = null;
            this.mesh.traverse((child) => {
                if (child.isBone) {
                    const name = child.name.toLowerCase();
                    // Avoid Fingers
                    if (name.includes('righthand') && !name.includes('thumb') && !name.includes('index') && !name.includes('middle') && !name.includes('ring') && !name.includes('pinky')) {
                        rightHand = child;
                    }
                    else if (!rightHand && (name.includes('hand.r') || name.includes('hand_r'))) {
                        rightHand = child;
                    }
                }
            });

            if (rightHand) {
                rightHand.add(this.weaponMesh);
            } else {
                console.warn(`RemotePlayer ${this.id}: Right Hand Bone not found. Attaching to root.`);
                this.scene.add(this.weaponMesh);
                // If attached to root, we need to respect the position/rot relative to root, 
                // but usually weapons are designed for Hand space.
                // We might need to adjust if root-attached, but hopefully bone is found.
            }
        }
    }

    dispose() {
        if (this.nameTag) this.nameTag.remove();
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.traverse((child) => {
                if (child.isMesh) {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                }
            });
        }
        if (this.bullets) {
            this.bullets.forEach(b => b.destroy());
            this.bullets = [];
        }
    }
}
