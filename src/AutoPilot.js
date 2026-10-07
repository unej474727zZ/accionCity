import * as THREE from 'three';

export class AutoPilot {
    constructor(world) {
        this.world = world;
        this.active = false;
        this.targetVehicle = null;
        this.timer = 0;
        
        // Expose to global scope so you can run it from the console
        window.startAutoPilot = () => {
            this.active = !this.active;
            console.log(`🤖 AutoPilot is now ${this.active ? 'ON' : 'OFF'}`);
            if (!this.active) {
                // Reset keys when turning off
                if (this.world.character) {
                    this.world.character.keys.forward = false;
                    this.world.character.keys.fire = false;
                    this.world.character.keys.run = false;
                    this.world.character.keys.ads = false; // RELEASE AIM
                }
            }
        };
    }

    update(dt) {
        if (!this.active) return;
        
        const char = this.world.character;
        if (!char || !char.mesh) return;

        // 1. AUTO RESPAWN
        if (char.isDead) {
            this.deathTimer = (this.deathTimer || 0) + dt;
            if (this.deathTimer > 3.0) { // Wait 3 seconds before respawning
                console.log("🤖 AutoPilot: I died. Respawning...");
                char.respawn();
                this.deathTimer = 0;
            }
            return;
        }

        // Get actual position (whether on foot or driving)
        const charPos = char.isDriving && char.vehicle ? char.vehicle.mesh.position : char.mesh.position;

        // --- STUCK DETECTION ---
        if (!this.lastPos) this.lastPos = charPos.clone();
        if (this.stuckTimer === undefined) {
            this.stuckTimer = 0;
            this.stuckCount = 0;
            this.evadeTimer = 0;
        }
        
        this.stuckTimer += dt;
        
        // If we are currently evading/unstucking, countdown the evade timer
        if (this.evadeTimer > 0) {
            this.evadeTimer -= dt;
            // Force jump and run while evading
            char.keys.jump = true;
            char.keys.run = true;
            char.keys.forward = true;
            char.keys.fire = false;
            char.keys.ads = false;
            // Stop aiming at the enemy, just keep the current yaw
            char.aimYaw = char.yaw; 
            char.aimPitch = 0;
            char.pitch = 0;
            
            // Release the evade after it ends
            if (this.evadeTimer <= 0) {
                char.keys.jump = false;
            }
            return; // Skip the rest of the logic while evading
        }

        if (this.stuckTimer > 0.5) { // Check every 0.5 seconds
            const distMoved = charPos.distanceTo(this.lastPos);
            // If trying to move forward but barely moved
            if (char.keys.forward && distMoved < 0.5 && !char.isDriving) {
                this.stuckCount++;
            } else {
                this.stuckCount = 0; 
            }
            this.lastPos.copy(charPos);
            this.stuckTimer = 0;
        }

        // If stuck 3 times in a row (1.5 seconds stuck), trigger evade!
        if (this.stuckCount >= 3) {
            console.log("🤖 AutoPilot: Stuck detected! Evading and releasing aim...");
            this.stuckCount = 0;
            this.evadeTimer = 1.0; // Evade for 1 second
            
            // Turn in a random direction to try and slide off the wall
            char.yaw += (Math.random() > 0.5 ? 1 : -1) * (Math.PI / 2);
            return;
        }
        // --- END STUCK DETECTION ---

        // 2. FIND NEAREST ENEMY
        let nearestEnemy = null;
        let minEnemyDist = Infinity;
        if (this.world.botManager && this.world.botManager.bots) {
            for (let bot of this.world.botManager.bots) {
                if (bot.state === 'dead' || !bot.mesh) continue;
                let dist = bot.mesh.position.distanceTo(charPos);
                if (dist < minEnemyDist) {
                    minEnemyDist = dist;
                    nearestEnemy = bot;
                }
            }
        }

        // 3. FIND VEHICLE TO STEAL (always look for one if on foot)
        if (!char.isDriving && !this.targetVehicle) {
            // Si hay enemigos, buscar un vehículo muy cercano (30m) para usarlo de tanque. Si no, buscar lejos (300m)
            const searchDist = nearestEnemy ? 40 : 300;
            this.targetVehicle = this.world.vehicleManager.findNearestVehicle(charPos, searchDist);
        }

        // Reset movement keys
        char.keys.forward = false;
        char.keys.backward = false;
        char.keys.left = false;
        char.keys.right = false;
        char.keys.run = false;

        // If we have a vehicle target, run to it (priority!)
        let movingToVehicle = false;
        if (this.targetVehicle && this.targetVehicle.mesh && !char.isDriving) {
            let vDist = charPos.distanceTo(this.targetVehicle.mesh.position);
            if (vDist > 6) {
                const dx = this.targetVehicle.mesh.position.x - charPos.x;
                const dz = this.targetVehicle.mesh.position.z - charPos.z;
                char.yaw = Math.atan2(dx, dz); // Face vehicle
                char.keys.forward = true;
                char.keys.run = true;
                movingToVehicle = true;
            } else {
                // Close enough, steal it!
                this.world.vehicleManager.enterVehicle(this.targetVehicle);
                this.targetVehicle = null;
            }
        }

        // 4. COMBAT LOGIC
        if (nearestEnemy && minEnemyDist < 500) { // CAZAR Y DISPARAR DESDE LEJOS (500m)
            
            // Aim at enemy
            const targetPos = nearestEnemy.mesh.position.clone();
            targetPos.y += 1.5; // Aim at chest/head, not feet
            
            const dx = targetPos.x - charPos.x;
            const dz = targetPos.z - charPos.z;
            const dy = targetPos.y - (charPos.y + 1.5); // difference in height
            
            const targetYaw = Math.atan2(dx, dz);
            const dist2D = Math.sqrt(dx*dx + dz*dz);
            const maxPitch = Math.PI / 4; 
            let targetPitch = -Math.atan2(dy, dist2D);
            targetPitch = Math.max(-maxPitch, Math.min(maxPitch, targetPitch));
            
            if (char.isDriving) {
                char.aimYaw = targetYaw; // Aim vehicle weapon
                char.pitch = targetPitch;
                char.aimPitch = targetPitch;
                char.keys.forward = true; // KEEP DRIVING!
            } else {
                // Smooth yaw rotation, but faster so it doesn't get stuck spinning
                if (!movingToVehicle) {
                    let diffYaw = targetYaw - char.yaw;
                    while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
                    while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
                    
                    char.yaw += diffYaw * 8.0 * dt; 
                }
                
                char.aimYaw = targetYaw; // THE WEAPON AIMS EXACTLY AT ENEMY
                char.pitch = targetPitch; 
                char.aimPitch = targetPitch; 
                
                // Ensure weapon is drawn
                if (char.weaponManager && char.weaponManager.currentWeaponType === null) {
                    char.weaponManager.toggleHolster();
                }
            }

            // Line of Sight Check
            let hasLineOfSight = false;
            const rayOrigin = charPos.clone().add(new THREE.Vector3(0, 1.5, 0));
            const rayDir = targetPos.clone().sub(rayOrigin).normalize();
            const ray = new THREE.Raycaster(rayOrigin, rayDir);
            ray.far = minEnemyDist;
            
            const hits = ray.intersectObjects(char.colliders, true);
            if (hits.length === 0) {
                hasLineOfSight = true;
            }

            // MOVEMENT DURING COMBAT
            if (!char.isDriving && !movingToVehicle) {
                if (hasLineOfSight) {
                    // CAMINAR Y DISPARAR
                    char.keys.forward = minEnemyDist > 20; // Acercarse caminando si esta a mas de 20m
                    char.keys.run = minEnemyDist > 100; // Correr si esta a mas de 100m
                    
                    // STRAFE PARA ESQUIVAR BALAS OCASIONALMENTE
                    if (Math.random() < 0.02) {
                        this.strafeDir = Math.random() > 0.5 ? 'left' : 'right';
                        this.strafeTime = (Math.random() * 1.5) + 0.5;
                    }
                } else {
                    // OCULTARSE / BUSCAR LINEA DE VISION
                    char.keys.forward = true;
                    char.keys.run = true;
                    
                    // Hacer strafe para asomarse por las esquinas o saltar obstaculos
                    if (!this.strafeTime || this.strafeTime <= 0) {
                        this.strafeDir = Math.random() > 0.5 ? 'left' : 'right';
                        this.strafeTime = 1.0;
                    }
                }

                // Aplicar el strafe
                if (this.strafeTime > 0) {
                    this.strafeTime -= dt;
                    if (this.strafeDir === 'left') char.keys.left = true;
                    if (this.strafeDir === 'right') char.keys.right = true;
                }
            }

            // Shoot and Aim ONLY if we can see them!
            const shouldShoot = hasLineOfSight;
            char.keys.fire = shouldShoot;
            
            // Activate ADS for Foot, Motorcycle, and Helicopter (NO Tank)
            const isTank = char.isDriving && char.vehicle && char.vehicle.type === 'tank';
            char.keys.ads = shouldShoot && !isTank; 

            // ZOOM OUT WHEN SHOOTING (¡Alejar la camara para liberar la mira!)
            if (char.keys.ads) {
                char.cameraDistance = 6.0; // Zoom LEJOS (antes era 0.8)
            } else {
                char.cameraDistance = 3.0; // Reset a 3ra persona normal
            }

        } else {
            // NO ENEMIES NEARBY
            char.keys.fire = false;
            char.keys.ads = false;
            char.cameraDistance = 3.0; // Reset zoom
            
            if (!char.isDriving && !movingToVehicle) {
                // Solo caminar hacia adelante como terminator buscando accion
                char.keys.forward = true;
                char.keys.run = false;
            } else if (char.isDriving) {
                // Driving, but no enemies. Just cruise.
                char.keys.forward = true;
                char.aimYaw += 0.01; // Spin camera around looking for trouble
            }
        }
    }
}
