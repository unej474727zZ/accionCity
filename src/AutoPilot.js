import * as THREE from 'three';

export class AutoPilot {
    constructor(world) {
        this.world = world;
        this.active = false;
        this.targetVehicle = null;
        this.timer = 0;
        this.vehicleEvadeTimer = 0;
        this.vehicleEvadeDir = 'right';
        this.vehicleStuckCount = 0;
        this.wanderTimer = 0;
        this.wanderTurn = 0;
        
        // Expose to global scope so you can run it from the console
        window.startAutoPilot = () => {
            this.active = !this.active;
            console.log(`🤖 AutoPilot is now ${this.active ? 'ON' : 'OFF'}`);
            if (!this.active) {
                // Reset keys when turning off
                if (this.world.character) {
                    this.world.character.keys.forward = false;
                    this.world.character.keys.backward = false;
                    this.world.character.keys.left = false;
                    this.world.character.keys.right = false;
                    this.world.character.keys.fire = false;
                    this.world.character.keys.run = false;
                    this.world.character.keys.ads = false; // RELEASE AIM
                    this.world.character.desiredFOV = 75;
                    const isTank = this.world.character.isDriving && this.world.character.vehicle && this.world.character.vehicle.type === 'tank';
                    this.world.character.cameraDistance = isTank ? 12.0 : 3.0;
                }
            }
        };
    }

    checkVehicleObstacles(char) {
        if (!char.isDriving || !char.vehicle || !char.vehicle.mesh) {
            return { blocked: false, steer: null, closeObstacle: false };
        }

        const vMesh = char.vehicle.mesh;
        const vPos = vMesh.position;
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(vMesh.quaternion);
        forward.y = 0;
        forward.normalize();

        const rightAxis = new THREE.Vector3(0, 1, 0);

        // Ray origins slightly in front and at bumper height
        const rayStart = vPos.clone().add(new THREE.Vector3(0, 0.8, 0)).add(forward.clone().multiplyScalar(1.2));

        // Center, Left (+22 deg), Right (-22 deg)
        const leftDir = forward.clone().applyAxisAngle(rightAxis, 0.38).normalize();
        const rightDir = forward.clone().applyAxisAngle(rightAxis, -0.38).normalize();

        // Collect all colliders (static scene + other vehicles)
        const colliders = [...(char.colliders || [])];
        if (this.world.vehicleManager && this.world.vehicleManager.vehicles) {
            for (const v of this.world.vehicleManager.vehicles) {
                if (v !== char.vehicle && v.mesh) {
                    colliders.push(v.mesh);
                }
            }
        }
        if (this.world.npcManager && this.world.npcManager.cars) {
            for (const car of this.world.npcManager.cars) {
                if (car) colliders.push(car);
            }
        }

        const checkRay = (origin, dir, maxDist) => {
            const ray = new THREE.Raycaster(origin, dir, 0.1, maxDist);
            const hits = ray.intersectObjects(colliders, true);
            const validHits = hits.filter(h => {
                let p = h.object;
                while (p) {
                    if (p === vMesh || p === char.mesh) return false;
                    p = p.parent;
                }
                return true;
            });
            return validHits.length > 0 ? validHits[0].distance : Infinity;
        };

        const centerDist = checkRay(rayStart, forward, 12.0);
        const leftDist = checkRay(rayStart, leftDir, 9.0);
        const rightDist = checkRay(rayStart, rightDir, 9.0);

        const closeObstacle = centerDist < 2.5;

        // Obstacle detected ahead within safety envelope
        if (centerDist < 9.0 || leftDist < 6.5 || rightDist < 6.5) {
            // Steer towards the side with more clearance
            const steer = (leftDist > rightDist) ? 'left' : 'right';
            return { blocked: true, steer, closeObstacle, centerDist, leftDist, rightDist };
        }

        return { blocked: false, steer: null, closeObstacle: false };
    }

    steerVehicleTowardsYaw(char, targetYaw, obstacleInfo) {
        if (!char.isDriving || !char.vehicle || !char.vehicle.mesh) return;

        const v = char.vehicle;
        const vMesh = v.mesh;

        // If whisker detected an obstacle, evasion takes priority!
        if (obstacleInfo && obstacleInfo.blocked) {
            if (obstacleInfo.steer === 'left') {
                char.keys.left = true;
                char.keys.right = false;
            } else {
                char.keys.right = true;
                char.keys.left = false;
            }
            if (obstacleInfo.closeObstacle) {
                char.keys.forward = false;
                char.keys.backward = true; // Temporary brake/reverse if right in front of obstacle
            } else {
                char.keys.forward = true;
            }
            return;
        }

        // Helicopter steering
        if (v.type === 'helicopter') {
            char.yaw = targetYaw;
            char.aimYaw = targetYaw;
            char.keys.forward = true;
            return;
        }

        // Land vehicles (motorcycle, tank)
        let diffYaw = targetYaw - vMesh.rotation.y;
        while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
        while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;

        if (diffYaw > 0.12) {
            // Target is to the left -> steer left
            char.keys.left = true;
            char.keys.right = false;
        } else if (diffYaw < -0.12) {
            // Target is to the right -> steer right
            char.keys.right = true;
            char.keys.left = false;
        } else {
            char.keys.left = false;
            char.keys.right = false;
        }

        char.keys.forward = true;
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
            this.vehicleStuckCount = 0;
            this.vehicleEvadeTimer = 0;
        }
        
        this.stuckTimer += dt;
        
        // 1. VEHICLE EVASION (Reverse + Turn)
        if (this.vehicleEvadeTimer > 0) {
            this.vehicleEvadeTimer -= dt;
            char.keys.forward = false;
            char.keys.backward = true; // REVERSE GEAR!
            char.keys.run = false;
            char.keys.jump = false;
            char.keys.fire = false;
            char.keys.ads = false;
            if (this.vehicleEvadeDir === 'left') {
                char.keys.left = true;
                char.keys.right = false;
            } else {
                char.keys.right = true;
                char.keys.left = false;
            }
            return; // Skip rest of logic during vehicle reverse evasion
        }

        // 2. FOOT EVASION
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
            
            if (char.isDriving) {
                // If trying to drive but barely moved
                if ((char.keys.forward || char.keys.backward) && distMoved < 0.4) {
                    this.vehicleStuckCount = (this.vehicleStuckCount || 0) + 1;
                } else {
                    this.vehicleStuckCount = 0;
                }
            } else {
                // If trying to move forward on foot but barely moved
                if (char.keys.forward && distMoved < 0.5) {
                    this.stuckCount++;
                } else {
                    this.stuckCount = 0; 
                }
            }
            
            this.lastPos.copy(charPos);
            this.stuckTimer = 0;
        }

        // Trigger Vehicle Evade (after ~1.0s stuck in vehicle)
        if (char.isDriving && this.vehicleStuckCount >= 2) {
            console.log("🤖 AutoPilot: Vehicle stuck detected! Reversing and steering away...");
            this.vehicleStuckCount = 0;
            this.vehicleEvadeTimer = 1.8; // Reverse for 1.8 seconds
            this.vehicleEvadeDir = Math.random() > 0.5 ? 'left' : 'right';
            return;
        }

        // If stuck 3 times in a row on foot (1.5 seconds stuck), trigger foot evade!
        if (!char.isDriving && this.stuckCount >= 3) {
            console.log("🤖 AutoPilot: Foot stuck detected! Evading and releasing aim...");
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
            // Si hay enemigos, buscar un vehículo muy cercano (40m) para usarlo de tanque. Si no, buscar lejos (300m)
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
            if (this.targetVehicle.isOccupiedByOther || !this.targetVehicle.mesh.visible) {
                this.targetVehicle = null; // Vehicle is already taken by someone else!
            } else {
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
        }

        // Whisker obstacle detection while driving
        const obstacleInfo = char.isDriving ? this.checkVehicleObstacles(char) : null;

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
            const maxPitch = Math.PI / 3; 
            // CORREGIDO: Ángulo positivo cuando el objetivo está más arriba (pitch > 0 mira hacia arriba)
            let targetPitch = Math.atan2(dy, dist2D);
            targetPitch = Math.max(-maxPitch, Math.min(maxPitch, targetPitch));

            let diffYaw = targetYaw - char.yaw;
            while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
            while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
            
            if (char.isDriving) {
                // Rotar cámara hacia el enemigo suavemente mientras conduce
                char.yaw += diffYaw * 10.0 * dt;
                char.aimYaw = char.yaw;
                char.pitch = targetPitch;
                char.aimPitch = targetPitch;

                // Steer vehicle towards the enemy (or evade obstacles)
                this.steerVehicleTowardsYaw(char, targetYaw, obstacleInfo);
            } else {
                // Smooth yaw rotation towards enemy
                if (!movingToVehicle) {
                    char.yaw += diffYaw * 10.0 * dt; 
                }
                
                char.aimYaw = char.yaw;
                char.pitch = targetPitch; 
                char.aimPitch = targetPitch; 
                
                // Ensure weapon is drawn
                if (char.weaponManager && (char.weaponManager.currentWeaponType === null || char.weaponManager.isHolstered)) {
                    char.weaponManager.toggleHolster();
                }
            }

            // Line of Sight Check (Including other vehicles so we don't shoot through helicopter/props)
            let hasLineOfSight = false;
            const rayOrigin = charPos.clone().add(new THREE.Vector3(0, 1.5, 0));
            const rayDir = targetPos.clone().sub(rayOrigin).normalize();
            const ray = new THREE.Raycaster(rayOrigin, rayDir, 0.1, minEnemyDist);

            const blockers = [...(char.colliders || [])];
            if (this.world.vehicleManager && this.world.vehicleManager.vehicles) {
                for (const v of this.world.vehicleManager.vehicles) {
                    if (v !== char.vehicle && v.mesh) {
                        blockers.push(v.mesh);
                    }
                }
            }
            
            const hits = ray.intersectObjects(blockers, true);
            const validHits = hits.filter(h => {
                let p = h.object;
                while (p) {
                    if (char.vehicle && p === char.vehicle.mesh) return false;
                    if (p === char.mesh) return false;
                    p = p.parent;
                }
                return true;
            });

            if (validHits.length === 0) {
                hasLineOfSight = true;
            }

            // MOVEMENT DURING COMBAT (On foot)
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

            // Disciplina de disparo: Solo disparar si tenemos línea de visión, no estamos corriendo al coche y la mira está encarada (< 25°)
            const isAimed = Math.abs(diffYaw) < 0.45;
            const shouldShoot = hasLineOfSight && !movingToVehicle && isAimed;
            char.keys.fire = shouldShoot;
            char.keys.ads = shouldShoot; 

            // ZOOM DINÁMICO IDÉNTICO A LA RUEDA DEL RATÓN:
            // Al apuntar/disparar, acerca la cámara y reduce FOV según la distancia (zoom sniper a larga distancia)
            // Al dejar de disparar, aleja la cámara y restaura la vista amplia normal
            const isTank = char.isDriving && char.vehicle && char.vehicle.type === 'tank';
            const isHeli = char.isDriving && char.vehicle && char.vehicle.type === 'helicopter';

            if (shouldShoot) {
                // ACERCAR LA MIRA (Zoom In dinámico según distancia)
                if (isTank) {
                    char.cameraDistance = 5.0;
                    char.desiredFOV = THREE.MathUtils.clamp(40 - (minEnemyDist / 80) * 20, 15, 35);
                } else if (isHeli) {
                    char.desiredFOV = THREE.MathUtils.clamp(35 - (minEnemyDist / 100) * 20, 10, 30);
                } else {
                    // A pie o en moto: primera persona (0.1) para precisión absoluta sin que el cuerpo bloquee la mira
                    char.cameraDistance = 0.1;
                    // Zoom dinámico de FOV: si el enemigo está lejos (ej. > 80m), FOV baja hasta 12 (zoom sniper)
                    char.desiredFOV = THREE.MathUtils.clamp(45 - (minEnemyDist / 50) * 30, 12, 50);
                }
            } else {
                // ALEJAR LA MIRA (Zoom Out a vista normal de navegación)
                if (isTank) {
                    char.cameraDistance = 12.0;
                    char.desiredFOV = 75;
                } else if (isHeli) {
                    char.desiredFOV = 75;
                } else {
                    char.cameraDistance = 3.0;
                    char.desiredFOV = 75;
                }
            }

        } else {
            // NO ENEMIES NEARBY
            char.keys.fire = false;
            char.keys.ads = false;
            char.desiredFOV = 75;
            const isTank = char.isDriving && char.vehicle && char.vehicle.type === 'tank';
            char.cameraDistance = isTank ? 12.0 : 3.0;
            
            if (!char.isDriving && !movingToVehicle) {
                // Solo caminar hacia adelante como terminator buscando accion
                char.keys.forward = true;
                char.keys.run = false;
            } else if (char.isDriving) {
                // Driving, but no enemies. Cruise and avoid obstacles!
                char.aimYaw += 0.01; // Spin camera around looking for trouble
                
                if (obstacleInfo && obstacleInfo.blocked) {
                    if (obstacleInfo.steer === 'left') {
                        char.keys.left = true;
                        char.keys.right = false;
                    } else {
                        char.keys.right = true;
                        char.keys.left = false;
                    }
                    if (obstacleInfo.closeObstacle) {
                        char.keys.forward = false;
                        char.keys.backward = true;
                    } else {
                        char.keys.forward = true;
                    }
                } else {
                    // Gentle patrol wander
                    if (!this.wanderTimer || this.wanderTimer <= 0) {
                        this.wanderTimer = 3.0 + Math.random() * 2.0;
                        this.wanderTurn = (Math.random() - 0.5) * 0.4; // slight occasional turn
                    }
                    this.wanderTimer -= dt;
                    if (this.wanderTurn > 0.1) {
                        char.keys.left = true;
                    } else if (this.wanderTurn < -0.1) {
                        char.keys.right = true;
                    }
                    char.keys.forward = true;
                }
            }
        }
    }
}
