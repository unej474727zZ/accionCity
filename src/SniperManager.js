import * as THREE from 'three';

export class SniperManager {
    constructor(world) {
        this.world = world;
        this.scene = world.scene;
        this.weaponManager = world.weaponManager;
        
        this.timer = 0;
        this.fireInterval = 3 + Math.random() * 12; // Between 3 and 15 seconds
        this.accuracy = 0.8; // 80% accuracy for snipers
    }

    update(dt) {
        if (!this.world.character || !this.world.character.mesh) return;
        
        const character = this.world.character;
        const targetObject = (character.isDriving && character.vehicle) ? character.vehicle.mesh : character.mesh;
        if (!targetObject) return;

        const playerPos = targetObject.position;
        
        // Only fire if inside the city (approx -430 to 430 range)
        if (Math.abs(playerPos.x) > 430 || Math.abs(playerPos.z) > 430) return;

        this.timer += dt;
        if (this.timer >= this.fireInterval) {
            console.log(`🎯 Sniper Timer: ${this.timer.toFixed(2)} / ${this.fireInterval.toFixed(2)}`);
            this.timer = 0;
            this.tryFire(playerPos, targetObject);
            // Randomize next shot interval (3 to 15 seconds)
            this.fireInterval = 3.0 + Math.random() * 12.0;
        }
    }

    tryFire(playerPos, targetObject) {
        if (this.world.cityBlocks.length > 0 && Math.random() < 0.1) {
             console.log("🏙️ Sample Block 0:", this.world.cityBlocks[0]);
        }
        console.log(`🔍 Sniper: Searching building near ${playerPos.x.toFixed(1)}, ${playerPos.z.toFixed(1)}. Total blocks: ${this.world.cityBlocks.length}`);
        
        // 1. Find a nearby building to spawn the bullet from
        const buildings = this.world.cityBlocks.filter(b => {
            const centerX = (b.minX + b.maxX) / 2;
            const centerZ = (b.minZ + b.maxZ) / 2;
            const dist = new THREE.Vector2(centerX, centerZ).distanceTo(new THREE.Vector2(playerPos.x, playerPos.z));
            return dist < 150 && dist > 5; 
        });

        if (buildings.length === 0) {
            console.warn("🚫 Sniper: No buildings found in radius!");
            return;
        }
        const block = buildings[Math.floor(Math.random() * buildings.length)];

        // 2. Pick a "window" position on building surface
        const spawnPos = new THREE.Vector3();
        const side = Math.floor(Math.random() * 4);
        const height = 8 + Math.random() * 25; 
        
        if (side === 0) spawnPos.set(block.minX, height, THREE.MathUtils.lerp(block.minZ, block.maxZ, Math.random()));
        else if (side === 1) spawnPos.set(block.maxX, height, THREE.MathUtils.lerp(block.minZ, block.maxZ, Math.random()));
        else if (side === 2) spawnPos.set(THREE.MathUtils.lerp(block.minX, block.maxX, Math.random()), height, block.minZ);
        else spawnPos.set(THREE.MathUtils.lerp(block.minX, block.maxX, Math.random()), height, block.maxZ);

        // 3. Target logic: prioritize canisters near player
        let targetPos = playerPos.clone().add(new THREE.Vector3(0, 1.2, 0));
        
        const nearbyCanister = this.weaponManager.canisters.find(c => c.mesh.position.distanceTo(playerPos) < 12);
        if (nearbyCanister && Math.random() < 0.6) {
            targetPos.copy(nearbyCanister.mesh.position);
        } else if (Math.random() > this.accuracy) {
            // Near miss
            targetPos.x += (Math.random() - 0.5) * 6;
            targetPos.z += (Math.random() - 0.5) * 6;
            targetPos.y = 0;
        }

        const dir = targetPos.clone().sub(spawnPos).normalize();
        
        // 4. Fire Bullet (Visual only until impact)
        const bulletMesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, 2.0), 
            new THREE.MeshBasicMaterial({ color: 0xffff00 })
        );
        bulletMesh.position.copy(spawnPos);
        bulletMesh.lookAt(targetPos);
        this.scene.add(bulletMesh);

        // Movement and Collision handling
        const bulletSpeed = 350;
        const ray = new THREE.Raycaster(spawnPos, dir);
        ray.far = 1000;
        
        const possibleTargets = [...this.world.character.colliders, targetObject];
        this.weaponManager.canisters.forEach(c => possibleTargets.push(c.mesh));
        if (this.world.vehicleManager) {
            this.world.vehicleManager.vehicles.forEach(v => possibleTargets.push(v.mesh));
        }

        const hits = ray.intersectObjects(possibleTargets, true);
        
        if (hits.length > 0) {
            const hit = hits[0];
            const timeToHit = (hit.distance / bulletSpeed) * 1000;

            // Bullet travel animation
            let elapsed = 0;
            const animateBullet = (dt_ms) => {
                elapsed += dt_ms;
                const progress = Math.min(elapsed / timeToHit, 1.0);
                bulletMesh.position.lerpVectors(spawnPos, hit.point, progress);
                if (progress < 1.0) requestAnimationFrame((t) => animateBullet(16));
                else {
                    this.scene.remove(bulletMesh);
                    this.handleImpact(hit);
                }
            };
            animateBullet(0);
        } else {
            setTimeout(() => this.scene.remove(bulletMesh), 1000);
        }
    }

    handleImpact(hit) {
        const obj = hit.object;
        const point = hit.point;
        const normal = hit.face ? hit.face.normal.clone().transformDirection(obj.matrixWorld) : new THREE.Vector3(0, 1, 0);

        // Effects
        this.weaponManager.createImpact(point, normal, 'spark', 1.0, obj);
        if (this.world.soundManager) this.world.soundManager.playShoot('rifle');

        // Damage Logic
        if (obj === this.world.character.mesh || obj.parent === this.world.character.mesh) {
            if (this.world.character.damage) this.world.character.damage(40); // Sniper is powerful
        }

        // Hit Canister?
        const canister = this.weaponManager.canisters.find(c => {
            let found = false;
            c.mesh.traverse(m => { if (m === obj) found = true; });
            return found;
        });
        if (canister) {
            this.weaponManager.explodeCanister(canister);
        }

        // Hit Vehicle?
        const targetVeh = this.world.vehicleManager.findVehicleByMesh(obj);
        if (targetVeh) {
            this.world.vehicleManager.damageVehicle(targetVeh, 0.25, obj);
        }
    }
}
