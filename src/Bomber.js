import * as THREE from 'three';

export class Bomber {
    constructor(world) {
        this.world = world;
        this.scene = world.scene;
        
        this.active = false;
        this.timer = 0;
        this.spawnInterval = 60.0; // Spawns every 60 seconds (1 minute)
        
        this.bombTimer = 0;
        this.bombInterval = 3.5; // Drops bomb every 3.5 seconds
        
        this.speed = 40.0;
        this.altitude = 150.0;
        
        this.direction = new THREE.Vector3();
        
        this.bombs = [];
        
        this.createMesh();
    }
    
    createMesh() {
        // Procedural Stealth Bomber
        this.mesh = new THREE.Group();
        
        const mat = new THREE.MeshBasicMaterial({ color: 0x111111 });
        
        // Main Body (Triangle/Kite shape)
        const shape = new THREE.Shape();
        shape.moveTo(0, 5); // Nose
        shape.lineTo(4, -4); // Right Wing
        shape.lineTo(0, -2); // Tail center
        shape.lineTo(-4, -4); // Left Wing
        shape.lineTo(0, 5); // Back to Nose
        
        const geom = new THREE.ShapeGeometry(shape);
        // Rotate so it lays flat
        geom.rotateX(-Math.PI / 2);
        
        const body = new THREE.Mesh(geom, mat);
        this.mesh.add(body);
        
        // Small cockpit hump
        const cockpitGeom = new THREE.BoxGeometry(1, 0.5, 2);
        const cockpit = new THREE.Mesh(cockpitGeom, new THREE.MeshBasicMaterial({ color: 0x050505 }));
        cockpit.position.set(0, 0.25, 1);
        this.mesh.add(cockpit);
        
        this.mesh.scale.set(2, 2, 2);
        this.mesh.visible = false;
        
        this.scene.add(this.mesh);
    }
    
    spawn() {
        this.active = true;
        this.mesh.visible = true;
        this.bombTimer = 0; // Reset bomb drop timer
        
        // Pick a random edge to spawn from
        const mapSize = 800;
        const half = mapSize / 2;
        
        const side = Math.floor(Math.random() * 4);
        let start = new THREE.Vector3();
        let end = new THREE.Vector3();
        
        // 50% Chance to target the player
        const targetPlayer = Math.random() < 0.5 && this.world.character && this.world.character.mesh;
        const pPos = targetPlayer ? this.world.character.mesh.position.clone() : new THREE.Vector3(0,0,0);
        
        if (side === 0) { // North to South
            start.set(targetPlayer ? pPos.x : (Math.random() - 0.5) * half, this.altitude, -half);
            end.set(targetPlayer ? pPos.x : (Math.random() - 0.5) * half, this.altitude, half);
        } else if (side === 1) { // South to North
            start.set(targetPlayer ? pPos.x : (Math.random() - 0.5) * half, this.altitude, half);
            end.set(targetPlayer ? pPos.x : (Math.random() - 0.5) * half, this.altitude, -half);
        } else if (side === 2) { // East to West
            start.set(half, this.altitude, targetPlayer ? pPos.z : (Math.random() - 0.5) * half);
            end.set(-half, this.altitude, targetPlayer ? pPos.z : (Math.random() - 0.5) * half);
        } else { // West to East
            start.set(-half, this.altitude, targetPlayer ? pPos.z : (Math.random() - 0.5) * half);
            end.set(half, this.altitude, targetPlayer ? pPos.z : (Math.random() - 0.5) * half);
        }
        
        this.mesh.position.copy(start);
        this.direction.subVectors(end, start).normalize();
        
        // Face the direction of travel
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);
    }
    
    dropBomb() {
        const bombGeom = new THREE.CylinderGeometry(0.2, 0.2, 1.0, 8);
        bombGeom.rotateX(Math.PI / 2);
        const bombMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
        const bombMesh = new THREE.Mesh(bombGeom, bombMat);
        
        bombMesh.position.copy(this.mesh.position);
        bombMesh.position.y -= 1; // Drop from below
        
        // Initial velocity is plane's velocity + falling
        const velocity = this.direction.clone().multiplyScalar(this.speed);
        
        this.scene.add(bombMesh);
        
        this.bombs.push({
            mesh: bombMesh,
            velocity: velocity,
            alive: true
        });
    }
    
    update(dt) {
        // Spawn Logic
        if (!this.active) {
            this.timer += dt;
            if (this.timer >= this.spawnInterval) {
                console.log("✈️ Bomber: Spawning flight!");
                this.timer = 0;
                this.spawn();
            }
        } else {
            // Move Bomber
            this.mesh.position.add(this.direction.clone().multiplyScalar(this.speed * dt));
            
            // Drop Bomb
            this.bombTimer += dt;
            if (this.bombTimer >= this.bombInterval) {
                this.bombTimer = 0;
                this.dropBomb();
            }
            
            // Check if out of bounds
            if (Math.abs(this.mesh.position.x) > 500 || Math.abs(this.mesh.position.z) > 500) {
                this.active = false;
                this.mesh.visible = false;
            }
            
            // Add a subtle plane engine sound based on distance
            if (this.world.soundManager && this.world.camera) {
                const dist = this.world.camera.position.distanceTo(this.mesh.position);
                if (dist < 400 && Math.random() < 0.1) {
                    // Could play a low rumbling sound here if available, or just leave it silent
                }
            }
        }
        
        // Update Bombs
        for (let i = this.bombs.length - 1; i >= 0; i--) {
            const bomb = this.bombs[i];
            if (!bomb.alive) continue;
            
            bomb.velocity.y -= 9.8 * 2 * dt; // Gravity
            bomb.mesh.position.add(bomb.velocity.clone().multiplyScalar(dt));
            
            // Point the bomb in its velocity direction
            if (bomb.velocity.lengthSq() > 0.1) {
                const dir = bomb.velocity.clone().normalize();
                bomb.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            }
            
            // Collision with ground
            if (bomb.mesh.position.y <= 0) {
                bomb.alive = false;
                bomb.mesh.position.y = 0;
                
                // Explode! (Optimized: Lowered scale to 2.0 to prevent lag, removed redundant impact)
                if (this.world.weaponManager) {
                    this.world.weaponManager.createExplosion(bomb.mesh.position, 2.0);
                    // Area damage (like bazooka)
                    this.world.weaponManager.applyAreaDamage(bomb.mesh.position, 10.0, 1.0);
                }
                
                // Sound
                if (this.world.soundManager) {
                    this.world.soundManager.playExplosion(bomb.mesh.position);
                }
                
                this.scene.remove(bomb.mesh);
                bomb.mesh.geometry.dispose();
                bomb.mesh.material.dispose();
                this.bombs.splice(i, 1);
            }
        }
    }
}
