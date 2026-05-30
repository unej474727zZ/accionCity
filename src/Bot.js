import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

export class Bot {
    constructor(scene, assets, id, initialPos, world, botManager) {
        this.scene = scene;
        this.assets = assets;
        this.id = id;
        this.world = world;
        this.botManager = botManager;

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        
        // AI State
        this.state = 'idle'; // idle, patrol, combat, dead
        this.aiTimer = 0;
        this.targetPoint = null;
        this.targetEntity = null; // Can be character or another bot
        this.yaw = 0;
        this.pitch = 0;
        this.hp = 100;
        
        // Weapon
        this.weaponType = 'pistol'; // Start with pistol by default
        this.weaponMesh = null;
        this.rightHandBone = null;
        this.firing = false;
        
        this.laserActive = true;
        this.laserMesh = this.createLaser();
        
        this.raycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();

        // Speed
        this.walkSpeed = 2.0;
        this.runSpeed = 6.0;

        this.init(initialPos);
    }

    init(initialPos) {
        const idleAsset = this.assets['idle'];
        if (idleAsset) {
            this.mesh = SkeletonUtils.clone(idleAsset.scene);
            this.mesh.userData.isBot = true;
            this.mesh.userData.botId = this.id;
            this.mesh.name = `Bot_${this.id}`;
            
            // Flag visual meshes so raycasters can ignore them to prevent lag
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    child.userData.isBotVisualMesh = true;
                }
            });

            this.playerColor = Math.random() * 0xffffff;
            this.scene.add(this.mesh);

            this.mesh.position.copy(initialPos);

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
            createMask('firing', 'firing');
            createMask('shooting', 'shooting');

            this.playAnimation('idle');

            // Find Hand Bone
            this.findHandBone();

            // SYNC COLOR
            this.tintMesh(this.mesh, this.playerColor);

            // NAME TAG
            this.createNameTag(`Bot-${this.id}`);

            this.scene.add(this.laserMesh);

            // HITBOX
            const hitGeom = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8);
            const hitMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthWrite: false });
            this.hitBox = new THREE.Mesh(hitGeom, hitMat);
            this.hitBox.name = "BotHitBox";
            this.hitBox.userData.isBot = true;
            this.hitBox.userData.botId = this.id;
            this.hitBox.position.y = 0.9;
            this.mesh.add(this.hitBox);

            // Equip Weapon
            if (Math.random() > 0.5) this.weaponType = 'rifle';
            this.setWeapon(this.weaponType);
            
            // Start by heading towards the player (spawn hunting)
            if (this.world.character && this.world.character.mesh) {
                this.targetPoint = this.world.character.mesh.position.clone();
                this.changeState('hunt');
            } else {
                this.changeState('patrol');
            }
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
                    child.material.color.setHex(colorHex);
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    createNameTag(name) {
        this.nameTag = document.createElement('div');
        this.nameTag.style.position = 'absolute';
        const color = new THREE.Color(this.playerColor);
        this.nameTag.style.color = color.getStyle();
        this.nameTag.style.background = 'rgba(0,0,0,0.5)';
        this.nameTag.style.padding = '2px 4px';
        this.nameTag.style.borderRadius = '4px';
        this.nameTag.style.fontSize = '12px';
        this.nameTag.style.pointerEvents = 'none';
        this.nameTag.style.userSelect = 'none';
        this.nameTag.innerText = name;
        document.body.appendChild(this.nameTag);
    }

    createLaser() {
        const laserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
        const laserMat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
        const laserMesh = new THREE.Line(laserGeom, laserMat);
        return laserMesh;
    }

    setWeapon(type) {
        if (this.weaponMesh) {
            if (this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
            this.weaponMesh = null;
        }

        const asset = this.assets[type];
        if (asset) {
            this.weaponMesh = asset.scene.clone();
            if (type === 'pistol') {
                this.weaponMesh.scale.set(15.0, 15.0, 15.0);
                this.weaponMesh.position.set(0.05, -0.2, 0.4);
                this.weaponMesh.rotation.set(0, Math.PI / 2, 0);
            } else if (type === 'rifle') {
                this.weaponMesh.scale.set(250.0, 250.0, 250.0);
                this.weaponMesh.position.set(0, -0.4, 0.5);
                this.weaponMesh.rotation.set(2.77, 5.74, -64.00);
            }

            if (this.rightHandBone) {
                this.rightHandBone.add(this.weaponMesh);
            } else {
                this.scene.add(this.weaponMesh);
            }
        }
    }

    changeState(newState) {
        if (this.state === 'dead') return;
        this.state = newState;
        if (newState === 'idle') {
            this.playAnimation('idle');
            this.firing = false;
        } else if (newState === 'patrol') {
            this.playAnimation('walk');
            this.firing = false;
            this.targetPoint = this.getRandomNavPoint();
        } else if (newState === 'hunt') {
            this.playAnimation('run');
            this.firing = false;
        } else if (newState === 'combat') {
            this.playAnimation('idle'); // Stop moving when shooting for now
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

    setFiring(isActive) {
        if (!this.mixer || !this.weaponType) return;

        const isRifle = (this.weaponType === 'rifle');
        const targetClipName = isRifle ? 'firing' : 'shooting';
        const otherClipName = isRifle ? 'shooting' : 'firing';

        const targetClip = this.animations[targetClipName];
        if (!targetClip) return;
        const targetAction = this.mixer.clipAction(targetClip);

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
                targetAction.setEffectiveWeight(1.0);
                targetAction.play();
                targetAction.fadeIn(0.2);
            }
        } else {
            if (targetAction.isRunning()) {
                targetAction.fadeOut(0.2);
            }
        }
    }

    getRandomNavPoint() {
        const radius = 30;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        return new THREE.Vector3(
            this.mesh.position.x + Math.cos(angle) * dist,
            0.5,
            this.mesh.position.z + Math.sin(angle) * dist
        );
    }

    takeDamage(amount, attacker) {
        if (this.state === 'dead') return;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die(attacker);
        } else {
            // Turn around / go into combat mode and target attacker
            if (attacker) {
                this.targetEntity = attacker;
                if (attacker.mesh) this.lastKnownPos = attacker.mesh.position.clone();
            }
            this.changeState('combat');
        }
    }

    die(killer) {
        this.state = 'dead';
        this.mesh.visible = false;
        if (this.weaponMesh) this.weaponMesh.visible = false;
        if (this.laserMesh) this.laserMesh.visible = false;
        if (this.nameTag) this.nameTag.style.display = 'none';
        
        // Notify any bots that were fighting ME to target my killer
        if (killer) {
            for (let otherBot of this.botManager.bots) {
                if (otherBot.state !== 'dead' && otherBot.targetEntity === this) {
                    otherBot.targetEntity = killer;
                    if (killer.mesh) otherBot.lastKnownPos = killer.mesh.position.clone();
                    otherBot.changeState('hunt');
                }
            }
        }
        
        // Let manager know
        setTimeout(() => {
            this.botManager.removeBot(this.id);
        }, 3000);
    }

    updateAI() {
        if (this.state === 'dead') return;

        const myPos = this.mesh.position.clone();

        // 1. Find targets
        let searchForTarget = true;

        if (this.targetEntity) {
            let isValid = false;
            const isPlayer = (this.targetEntity === this.world.character || this.targetEntity === this.world.characterController?.character);
            
            if (isPlayer && this.world.character.state !== 'dead') {
                let targetPos = this.world.character.mesh.position.clone();
                if (this.world.characterController && this.world.characterController.isDriving && this.world.characterController.vehicle) {
                    targetPos = this.world.characterController.vehicle.mesh.position.clone();
                } else {
                    this.world.character.mesh.getWorldPosition(targetPos);
                }
                isValid = this.checkLoS(targetPos);
                if (isValid) this.lastKnownPos = targetPos.clone();
            } else if (!isPlayer && this.targetEntity.state !== 'dead' && this.targetEntity.mesh) {
                let targetPos = new THREE.Vector3();
                this.targetEntity.mesh.getWorldPosition(targetPos);
                isValid = this.checkLoS(targetPos);
                if (isValid) this.lastKnownPos = targetPos.clone();
            }

            if (!isValid) {
                // Lost sight of target: run to last known position instead of giving up immediately
                if (this.lastKnownPos) {
                    this.targetPoint = this.lastKnownPos.clone();
                    this.changeState('hunt');
                } else {
                    this.targetEntity = null;
                    if (this.state === 'combat') this.changeState('patrol');
                }
            } else {
                searchForTarget = false;
                if (this.state !== 'combat') this.changeState('combat');
            }
        }

        if (searchForTarget) {
            let closestTarget = null;
            let minTargetDist = 80.0; // Vision range increased
            
            // Check local player
            if (this.world.character && this.world.character.mesh && this.world.character.state !== 'dead') {
                let charPos = new THREE.Vector3();
                if (this.world.characterController && this.world.characterController.isDriving && this.world.characterController.vehicle) {
                    charPos = this.world.characterController.vehicle.mesh.position.clone();
                } else {
                    this.world.character.mesh.getWorldPosition(charPos);
                }
                
                const dist = myPos.distanceTo(charPos);
                if (dist < minTargetDist) {
                    if (this.checkLoS(charPos)) {
                        minTargetDist = dist;
                        closestTarget = this.world.character;
                    }
                }
            }

            // Check other bots
            for (let bot of this.botManager.bots) {
                if (bot.id !== this.id && bot.state !== 'dead') {
                    const dist = myPos.distanceTo(bot.mesh.position);
                    if (dist < minTargetDist) {
                        if (this.checkLoS(bot.mesh.position)) {
                            minTargetDist = dist;
                            closestTarget = bot;
                        }
                    }
                }
            }

            if (closestTarget) {
                this.targetEntity = closestTarget;
                this.changeState('combat');
            }
        }

        // Logic based on state
        if (this.state === 'patrol' || this.state === 'hunt') {
            if (this.targetPoint) {
                const dist = myPos.distanceTo(this.targetPoint);
                if (dist < 2.0) {
                    if (this.state === 'hunt') {
                        // Reached last known pos but didn't find target
                        this.targetEntity = null;
                        this.lastKnownPos = null;
                        this.changeState('patrol');
                    } else {
                        this.targetPoint = this.getRandomNavPoint();
                    }
                } else {
                    // Walk/Run towards point
                    const dir = this.targetPoint.clone().sub(myPos).normalize();
                    this.yaw = Math.atan2(dir.x, dir.z);
                    
                    // Simple avoidance
                    this.wallRaycaster.set(myPos.clone().add(new THREE.Vector3(0, 1, 0)), dir);
                    const colliders = this.world.colliders || [];
                    const hits = this.wallRaycaster.intersectObjects(colliders, false);
                    if (hits.length > 0 && hits[0].distance < 3.0) {
                        if (this.state === 'hunt') {
                            this.targetEntity = null;
                            this.lastKnownPos = null;
                            this.changeState('patrol'); // Give up hunt if blocked
                        } else {
                            this.targetPoint = this.getRandomNavPoint(); // Turn around
                        }
                    }
                }
            }
        } else if (this.state === 'combat') {
            if (this.targetEntity) {
                // Determine target position (handle player in vehicle)
                let tPos = this.targetEntity.mesh.position.clone();
                
                // If targeting the player and player is driving, target the vehicle instead
                const isPlayer = (this.targetEntity === this.world.character || this.targetEntity === this.world.characterController?.character);
                if (isPlayer && this.world.characterController && this.world.characterController.isDriving && this.world.characterController.vehicle) {
                    tPos = this.world.characterController.vehicle.mesh.position.clone();
                }

                const dir = tPos.clone().sub(myPos).normalize();
                this.yaw = Math.atan2(dir.x, dir.z);
                
                const dist = myPos.distanceTo(tPos);

                // If too far, run towards target while in combat
                if (dist > 15.0) {
                    this.playAnimation('run');
                    myPos.x += dir.x * this.runSpeed * dt;
                    myPos.z += dir.z * this.runSpeed * dt;
                    // simple gravity
                    if (myPos.y > 0.5) {
                        myPos.y -= 9.8 * dt;
                        if (myPos.y < 0.5) myPos.y = 0.5;
                    }
                } else {
                    this.playAnimation('idle');
                }
                
                // Shoot periodically
                if (Math.random() < 0.2) {
                    this.firing = true;
                    // Actually shoot logic
                    if (this.world.weaponManager) {
                        // Muzzle start
                        const start = myPos.clone().add(new THREE.Vector3(0, 1.5, 0));
                        // Add some inaccuracy
                        const spread = 0.05;
                        dir.x += (Math.random() - 0.5) * spread;
                        dir.y += (Math.random() - 0.5) * spread;
                        dir.z += (Math.random() - 0.5) * spread;
                        dir.normalize();
                        
                        this.world.weaponManager.botShoot(this, start, dir, this.weaponType);
                    }
                } else {
                    this.firing = false;
                }
            }
        }
    }

    checkLoS(targetPos) {
        const start = this.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
        const end = targetPos.clone().add(new THREE.Vector3(0, 1.5, 0));
        const dir = end.clone().sub(start).normalize();
        const dist = start.distanceTo(end);

        this.raycaster.set(start, dir);
        this.raycaster.far = dist;

        const colliders = this.world.colliders || [];
        const hits = this.raycaster.intersectObjects(colliders, false);
        return hits.length === 0; // If no hit with wall, we have LoS
    }

    update(dt) {
        if (!this.mesh) return;

        // Visual updates
        if (this.mixer) this.mixer.update(dt);
        
        this.mesh.rotation.y = this.yaw;

        this.setFiring(this.firing);
        if (this.laserMesh && this.weaponMesh) {
            this.laserMesh.visible = this.firing || this.state === 'combat';
            if (this.laserMesh.visible) {
                const start = this.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));
                const dir = new THREE.Vector3(0, 0, 1);
                dir.applyEuler(new THREE.Euler(-this.pitch, this.yaw, 0, 'YXZ'));
                const end = start.clone().add(dir.multiplyScalar(50));
                
                const positions = this.laserMesh.geometry.attributes.position.array;
                positions[0] = start.x; positions[1] = start.y; positions[2] = start.z;
                positions[3] = end.x; positions[4] = end.y; positions[5] = end.z;
                this.laserMesh.geometry.attributes.position.needsUpdate = true;
            }
        }

        // Physical movement update
        if ((this.state === 'patrol' || this.state === 'hunt') && this.targetPoint) {
            const speed = this.state === 'hunt' ? this.runSpeed : this.walkSpeed;
            const myPos = this.mesh.position;
            const dir = this.targetPoint.clone().sub(myPos).normalize();
            myPos.x += dir.x * speed * dt;
            myPos.z += dir.z * speed * dt;
            
            // simple gravity
            if (myPos.y > 0.5) {
                myPos.y -= 9.8 * dt;
                if (myPos.y < 0.5) myPos.y = 0.5;
            }
        }

        // Name tag
        if (this.nameTag && this.world.camera) {
            const pos = this.mesh.position.clone().add(new THREE.Vector3(0, 2.2, 0));
            pos.project(this.world.camera);
            if (pos.z < 1 && this.state !== 'dead') {
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
        if (this.weaponMesh) {
            if (this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
        }
    }
}
