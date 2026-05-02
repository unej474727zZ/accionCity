import * as THREE from 'three';

export class SpiderManager {
    constructor(scene, characterController, assets) {
        this.scene = scene;
        this.characterController = characterController;
        this.assets = assets;
        this.spiders = [];
        this.spiderCount = 5;
        this.lastSpawnTime = 0;
        
        console.log("🕷️ SpiderManager: Ready to spawn mechs.");
    }

    spawn(position) {
        const modelAsset = this.assets['spiderMech'];
        if (!modelAsset) {
            console.error("🕷️ SpiderManager: spiderMech asset NOT FOUND!");
            return;
        }

        const model = modelAsset.scene.clone();
        
        // Setup Spider Object
        const spider = {
            mesh: model,
            health: 100,
            state: 'patrol', // patrol, chase, attack
            targetPos: position.clone(),
            velocity: new THREE.Vector3(),
            up: new THREE.Vector3(0, 1, 0), // Surface normal
            raycaster: new THREE.Raycaster(),
            lastAttackTime: 0,
            legTimer: 0,
            id: Math.random().toString(36).substr(2, 9)
        };

        // Scale down the huge model
        model.scale.set(0.1, 0.1, 0.1); 
        model.position.copy(position);
        
        // Identify legs for procedural animation
        spider.legs = [];
        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Basic heuristic: meshes that aren't the central body
                if (child.name.includes('Object_') && !child.name.includes('Object_2')) {
                    spider.legs.push(child);
                }
            }
        });

        this.scene.add(model);
        this.spiders.push(spider);
        console.log(`🕷️ Spider Spawned at ${position.x}, ${position.z}`);
        return spider;
    }

    update(dt) {
        if (!this.characterController) return;
        const playerPos = this.characterController.mesh.position;

        this.spiders.forEach(spider => {
            this.updateAI(spider, playerPos, dt);
            this.updatePhysics(spider, dt);
            this.updateAnimation(spider, dt);
        });
    }

    updateAI(spider, playerPos, dt) {
        const dist = spider.mesh.position.distanceTo(playerPos);

        if (dist < 50) {
            spider.state = 'chase';
            spider.targetPos.copy(playerPos);
        } else {
            spider.state = 'patrol';
            // Random patrol logic...
        }

        // Face target
        const dir = spider.targetPos.clone().sub(spider.mesh.position).normalize();
        if (dir.length() > 0.01) {
            // Smoothly rotate towards target while respecting surface normal
            const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            spider.mesh.quaternion.slerp(targetQuat, dt * 2.0);
        }
    }

    updatePhysics(spider, dt) {
        // 1. STICK TO SURFACES (Wall/Ceiling Walking)
        // Raycast "down" from spider center
        const down = new THREE.Vector3(0, -1, 0).applyQuaternion(spider.mesh.quaternion);
        spider.raycaster.set(spider.mesh.position.clone().add(new THREE.Vector3(0, 1, 0).applyQuaternion(spider.mesh.quaternion)), down);
        
        // Check scenery colliders
        const colliders = this.characterController.colliders || [];
        const hits = spider.raycaster.intersectObjects(colliders, true);

        if (hits.length > 0 && hits[0].distance < 3.0) {
            const hit = hits[0];
            
            // Get World Normal
            const worldNormal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);

            // Snap to surface
            spider.mesh.position.copy(hit.point).add(worldNormal.clone().multiplyScalar(0.2));
            
            // Align UP vector to surface normal
            const targetUp = worldNormal.clone();
            const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(spider.mesh.quaternion);
            
            const quat = new THREE.Quaternion().setFromUnitVectors(currentUp, targetUp);
            spider.mesh.quaternion.premultiply(quat);
        } else {
            // Gravity if not touching anything
            spider.mesh.position.y -= 9.8 * dt;
        }

        // 2. MOVEMENT
        if (spider.state === 'chase' || spider.state === 'patrol') {
            const moveSpeed = spider.state === 'chase' ? 8.0 : 3.0;
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(spider.mesh.quaternion);
            spider.mesh.position.add(forward.multiplyScalar(moveSpeed * dt));
        }
    }

    updateAnimation(spider, dt) {
        spider.legTimer += dt * 10;
        
        // Simple leg cycle: oscilate legs based on name/index
        spider.legs.forEach((leg, i) => {
            const phase = (i % 2 === 0) ? 0 : Math.PI;
            const offset = Math.sin(spider.legTimer + phase) * 0.2;
            
            // Heuristic: rotate X for forward/backward step
            leg.rotation.x = offset;
            // Slightly lift Y
            leg.position.y = Math.max(0, offset * 0.5);
        });
    }

    damage(spider, amount) {
        spider.health -= amount;
        if (spider.health <= 0) {
            this.explode(spider);
        }
    }

    explode(spider) {
        // Visual explosion
        if (this.characterController.weaponManager) {
            this.characterController.weaponManager.createExplosion(spider.mesh.position, 2.0);
        }
        
        this.scene.remove(spider.mesh);
        this.spiders = this.spiders.filter(s => s.id !== spider.id);
    }
}
