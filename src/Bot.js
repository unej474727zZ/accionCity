import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// --- STATIC SCRATCH VECTORS (Zero Garbage Collection in Frame Loops) ---
const _vStart = new THREE.Vector3();
const _vEnd = new THREE.Vector3();
const _vDir = new THREE.Vector3();
const _vTarget = new THREE.Vector3();
const _vProbe = new THREE.Vector3();
const _vSide = new THREE.Vector3();
const _vScreen = new THREE.Vector3();

// Shared geometries and materials for all 3 bots to save RAM/VRAM
const sharedHitGeom = new THREE.CylinderGeometry(0.35, 0.35, 1.8, 8);
const sharedHitMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0, depthWrite: false });
const sharedLaserGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
const sharedLaserMat = new THREE.LineBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });

export class Bot {
    constructor(scene, assets, id, initialPos, world, botManager, botIndex = 0) {
        this.scene = scene;
        this.assets = assets;
        this.id = id;
        this.world = world;
        this.botManager = botManager;
        this.botIndex = botIndex; // 0 = Front, 1 = Left Flank, 2 = Right Flank

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;

        // Tactical Flanking Angle (Pincer pursuit formation)
        this.formationAngle = (botIndex === 1) ? 0.75 : (botIndex === 2) ? -0.75 : 0;

        // AI State
        this.state = 'hunt'; // hunt (chasing protagonist), combat (attacking protagonist), dead
        this.targetPoint = new THREE.Vector3().copy(initialPos);
        this.yaw = 0;
        this.pitch = 0;
        this.hp = 100;
        this.hasLoS = false;
        this.lastKnownPos = new THREE.Vector3().copy(initialPos);
        this.respawnTimer = 0;

        // Weapon
        this.weaponType = (botIndex % 2 === 0) ? 'rifle' : 'pistol';
        this.weaponMesh = null;
        this.rightHandBone = null;
        this.firing = false;
        this.combatMove = false;

        // Speed
        this.walkSpeed = 2.8;
        this.runSpeed = 6.8;

        // Laser
        this.laserMesh = new THREE.Line(sharedLaserGeom.clone(), sharedLaserMat);
        this.raycaster = new THREE.Raycaster();
        this.wallRaycaster = new THREE.Raycaster();

        // 3 distinct squad colors (Fluorescent / Radioactive)
        const squadColors = [0x00ff00, 0x00ffff, 0xff00ff]; // Neon Green, Cyan, Magenta
        this.playerColor = squadColors[botIndex % squadColors.length];

        this.init(initialPos);
    }

    init(initialPos) {
        const idleAsset = this.assets['idle'];
        if (idleAsset) {
            this.mesh = SkeletonUtils.clone(idleAsset.scene);
            this.mesh.userData.isBot = true;
            this.mesh.userData.botId = this.id;
            this.mesh.name = `Pursuer_${this.id}`;
            this.mesh.scale.set(0.85, 0.85, 0.85);

            // Flag visual meshes so raycasters ignore them
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    child.userData.isBotVisualMesh = true;
                }
            });

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

            this.playAnimation('run');

            // Find Hand Bone
            this.findHandBone();

            // Tint squad color
            this.tintMesh(this.mesh, this.playerColor);

            // Hitbox
            this.hitBox = new THREE.Mesh(sharedHitGeom, sharedHitMat);
            this.hitBox.name = "BotHitBox";
            this.hitBox.userData.isBot = true;
            this.hitBox.userData.botId = this.id;
            this.hitBox.position.y = 0.9;
            this.mesh.add(this.hitBox);

            // Laser line
            this.scene.add(this.laserMesh);

            // Equip Weapon
            this.setWeapon(this.weaponType);

            // Permanent HUD Tag
            this.createNameTag(`Hunter-${this.botIndex + 1}`);
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
                    
                    // Make them radioactive / fluorescent
                    if (child.material.emissive !== undefined) {
                        child.material.emissive.setHex(colorHex);
                        child.material.emissiveIntensity = 2.0;
                    }
                    
                    child.material.needsUpdate = true;
                }
            }
        });
    }

    createNameTag(name) {
        this.nameTag = document.createElement('div');
        this.nameTag.style.position = 'absolute';
        this.nameTag.style.color = '#ff3333';
        this.nameTag.style.background = 'rgba(0,0,0,0.65)';
        this.nameTag.style.border = '1px solid #ff3333';
        this.nameTag.style.padding = '1px 5px';
        this.nameTag.style.borderRadius = '3px';
        this.nameTag.style.fontSize = '11px';
        this.nameTag.style.fontWeight = 'bold';
        this.nameTag.style.pointerEvents = 'none';
        this.nameTag.style.userSelect = 'none';
        this.nameTag.innerText = name;
        document.body.appendChild(this.nameTag);
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

    getProtagonistPos(outPos) {
        if (!this.world.character || !this.world.character.mesh) return false;
        if (this.world.characterController && this.world.characterController.isDriving && this.world.characterController.vehicle) {
            outPos.copy(this.world.characterController.vehicle.mesh.position);
        } else {
            this.world.character.mesh.getWorldPosition(outPos);
        }
        return true;
    }

    checkLoS(targetPos) {
        if (!this.mesh) return false;
        _vStart.copy(this.mesh.position);
        _vStart.y += 1.5;
        _vEnd.copy(targetPos);
        _vEnd.y += 1.5;

        _vDir.subVectors(_vEnd, _vStart);
        const dist = _vDir.length();
        if (dist > 120) return false;
        _vDir.normalize();

        this.raycaster.set(_vStart, _vDir);
        this.raycaster.far = dist;

        const colliders = this.world.colliders || [];
        const hits = this.raycaster.intersectObjects(colliders, false);
        return hits.length === 0;
    }

    updateAI() {
        if (this.state === 'dead' || !this.mesh) return;

        // 1. Get Protagonist Position (Always our primary target)
        if (!this.getProtagonistPos(_vTarget)) return;

        const myPos = this.mesh.position;
        const dist = myPos.distanceTo(_vTarget);

        // 2. Line of Sight Check
        this.hasLoS = this.checkLoS(_vTarget);
        if (this.hasLoS) {
            this.lastKnownPos.copy(_vTarget);
        }

        // 3. Tactical Formation Destination
        // Each of the 3 bots approaches from a different flanking angle
        _vDir.subVectors(_vTarget, myPos).normalize();
        this.yaw = Math.atan2(_vDir.x, _vDir.z);

        if (dist > 25) {
            // Far away: sprint directly towards protagonist
            this.targetPoint.copy(_vTarget);
            this.state = 'hunt';
            this.combatMove = true;
            this.firing = false;
        } else {
            // Close range: Apply flanking offset around the protagonist
            const flankDist = Math.max(8.0, Math.min(18.0, dist));
            const angle = this.yaw + this.formationAngle;
            this.targetPoint.set(
                _vTarget.x - Math.sin(angle) * flankDist,
                0.5,
                _vTarget.z - Math.cos(angle) * flankDist
            );

            this.state = 'combat';
            this.combatMove = (dist > 10.0);

            // Fire at protagonist if in LoS
            if (this.hasLoS && Math.random() < 0.35) {
                this.firing = true;
                if (this.world.weaponManager) {
                    _vStart.copy(myPos);
                    _vStart.y += 1.5;

                    _vDir.subVectors(_vTarget, _vStart).normalize();
                    // Slight spread for balance
                    _vDir.x += (Math.random() - 0.5) * 0.04;
                    _vDir.y += (Math.random() - 0.5) * 0.04;
                    _vDir.z += (Math.random() - 0.5) * 0.04;
                    _vDir.normalize();

                    this.world.weaponManager.botShoot(this, _vStart, _vDir, this.weaponType);
                }
            } else {
                this.firing = false;
            }
        }
    }

    update(dt) {
        if (!this.mesh || this.state === 'dead') return;

        if (this.mixer) this.mixer.update(dt);

        this.mesh.rotation.y = this.yaw;
        this.setFiring(this.firing);

        // Laser sight
        if (this.laserMesh && this.weaponMesh) {
            this.laserMesh.visible = (this.firing || (this.state === 'combat' && this.hasLoS));
            if (this.laserMesh.visible) {
                _vStart.copy(this.mesh.position);
                _vStart.y += 1.5;
                _vDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
                _vEnd.copy(_vStart).addScaledVector(_vDir, 40);

                const positions = this.laserMesh.geometry.attributes.position.array;
                positions[0] = _vStart.x; positions[1] = _vStart.y; positions[2] = _vStart.z;
                positions[3] = _vEnd.x; positions[4] = _vEnd.y; positions[5] = _vEnd.z;
                this.laserMesh.geometry.attributes.position.needsUpdate = true;
            }
        }

        // MOVEMENT & OBSTACLE AVOIDANCE
        const myPos = this.mesh.position;
        if (this.targetPoint) {
            const distToDest = myPos.distanceTo(this.targetPoint);
            if (distToDest > 1.5) {
                _vDir.subVectors(this.targetPoint, myPos).normalize();

                // Wall probe raycast (3m forward)
                _vProbe.copy(myPos);
                _vProbe.y += 1.0;
                this.wallRaycaster.set(_vProbe, _vDir);
                const colliders = this.world.colliders || [];
                const hits = this.wallRaycaster.intersectObjects(colliders, false);

                if (hits.length > 0 && hits[0].distance < 3.0) {
                    // Check side probes to slide around obstacles smoothly
                    _vSide.set(-_vDir.z, 0, _vDir.x); // Perpendicular vector
                    if (this.botIndex % 2 === 1) _vSide.negate();
                    _vDir.addScaledVector(_vSide, 1.2).normalize();
                }

                const speed = (this.state === 'hunt' || this.combatMove) ? this.runSpeed : this.walkSpeed;
                myPos.x += _vDir.x * speed * dt;
                myPos.z += _vDir.z * speed * dt;

                this.playAnimation((this.state === 'hunt' || this.combatMove) ? 'run' : 'walk');
            } else {
                if (this.state === 'combat') {
                    this.playAnimation('idle');
                }
            }

            // Simple ground stick
            if (myPos.y > 0.5) {
                myPos.y -= 9.8 * dt;
                if (myPos.y < 0.5) myPos.y = 0.5;
            }
        }

        // Screen Name Tag
        if (this.nameTag && this.world.camera) {
            _vScreen.copy(this.mesh.position);
            _vScreen.y += 2.2;
            _vScreen.project(this.world.camera);
            if (_vScreen.z < 1.0) {
                this.nameTag.style.display = 'block';
                this.nameTag.style.left = `${(_vScreen.x * 0.5 + 0.5) * window.innerWidth}px`;
                this.nameTag.style.top = `${(-_vScreen.y * 0.5 + 0.5) * window.innerHeight}px`;
                this.nameTag.style.transform = 'translate(-50%, -100%)';
            } else {
                this.nameTag.style.display = 'none';
            }
        }
    }

    takeDamage(amount, attacker) {
        if (this.state === 'dead') return;
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.state = 'dead';
        this.mesh.visible = false;
        if (this.weaponMesh) this.weaponMesh.visible = false;
        if (this.laserMesh) this.laserMesh.visible = false;
        if (this.nameTag) this.nameTag.style.display = 'none';

        if (this.botManager) {
            this.botManager.onBotKilled(this);
        }
    }

    respawn(spawnPos) {
        if (!this.mesh) return;
        this.mesh.position.copy(spawnPos);
        this.hp = 100;
        this.state = 'hunt';
        this.firing = false;
        this.combatMove = true;
        this.targetPoint.copy(spawnPos);

        this.mesh.visible = true;
        if (this.weaponMesh) this.weaponMesh.visible = true;
        if (this.nameTag) this.nameTag.style.display = 'block';

        this.playAnimation('run');
    }

    dispose() {
        if (this.nameTag) this.nameTag.remove();
        if (this.mesh) this.scene.remove(this.mesh);
        if (this.laserMesh) this.scene.remove(this.laserMesh);
        if (this.weaponMesh && this.weaponMesh.parent) {
            this.weaponMesh.parent.remove(this.weaponMesh);
        }
    }
}
