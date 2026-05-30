import * as THREE from 'three';

export class VehicleManager {
    constructor(scene, assets, characterController) {
        this.scene = scene;
        this.assets = assets;
        this.characterController = characterController;
        this.vehicles = [];
        this.currentVehicle = null;
        this.wheels = [];
        this.audioLoader = new THREE.AudioLoader();

        // Vehicle Settings
        this.settings = {
            motorcycle: {
                speed: 25,
                turnSpeed: 2.0,
                scale: 0.9,
                // Balanced seat position for the un-folded pose
                seatOffset: new THREE.Vector3(0, 0, 0)
            },
            tank: {
                speed: 15.0, // Fixed: Missing speed was causing NaN in audio logic
                turnSpeed: 1.5, // THE ROOT CAUSE: Missing turnSpeed caused NaN on steering!
                scale: 1.2,
                seatOffset: new THREE.Vector3(0, 5, 0) // Seat inside hull (doesn't matter since invisible)
            },
            helicopter: {
                speed: 75.0,
                liftSpeed: 25.0,
                turnSpeed: 1.8,
                scale: 1.0,
                seatOffset: new THREE.Vector3(0, 1.2, 0.5) // Adjust to fit in cockpit
            }
        };
    }

    spawnVehicle(type, position, rotation, id = null) {
        if (!this.assets[type]) {
            console.warn(`Vehicle type ${type} not found in assets.`);
            return;
        }

        const model = this.assets[type].scene.clone();
        model.scale.setScalar(this.settings[type]?.scale || 1.0);

        // HELICOPTER CENTERING FIX: Center the model relative to its local origin BEFORE positioning
        if (type === 'helicopter') {
            const bbox = new THREE.Box3().setFromObject(model);
            const center = bbox.getCenter(new THREE.Vector3());
            // Center horizontally (X, Z) only.
            // The model's origin is already at the bottom (skids), so we don't adjust Y.
            model.children.forEach(child => {
                child.position.x -= center.x;
                // child.position.y -= bbox.min.y; // Removed: caused helicopter to float 4.6m high
                child.position.z -= center.z;
            });
            const height = bbox.max.y - bbox.min.y;
            model.userData.halfHeight = height / 2;
            console.log(`[HELI] Model centered. Offset applied: ${center.x.toFixed(2)}, BOTTOM: ${bbox.min.y.toFixed(2)}, ${center.z.toFixed(2)}. Half-height: ${model.userData.halfHeight.toFixed(2)}`);
        }

        model.position.copy(position);
        // Removed: model.position.y += model.userData.halfHeight; 
        // We now rely on the server position or the explicit ground snap in World.js
        if (rotation) model.rotation.copy(rotation);

        // Shadow support
        const vehicleWheels = [];
        let turretNode = null;
        let canonNode = null;
        let mgNode = null;

        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                child.frustumCulled = false; // Prevent disappearing when moving children
            }

            const name = child.name.toLowerCase();

            // PRIORITY DETECTION: Prioritize exact matches like 'turret' or 'gunbracket'
            // We ignore generic names like 'object_4' if something better is found.

            // Detection for Turret (Horizontal Yaw pivot)
            const isTurretKey = (name === 'turret' || name === 'torreta' || name === 'tower');
            const isTurretSubstring = (name.includes('turret') || name.includes('torreta') || name.includes('tower'));

            if (isTurretKey) {
                turretNode = child;
            } else if (!turretNode && isTurretSubstring) {
                turretNode = child;
            }

            if (type !== 'tank' && child.isMesh && (name.includes('wheel') || name.includes('tire') || name.includes('roda'))) {
                vehicleWheels.push(child);
            }
        });

        // SECOND PASS: Find the canon pivot ONLY inside the turret hierarchy
        if (turretNode) {
            turretNode.traverse(child => {
                const name = child.name.toLowerCase();
                const isMG = name.includes('mg') || name.includes('nsvt') || name.includes('weapon2') || name.includes('anti');
                if (isMG) return;

                const isCanonKey = (name === 'mount' || name === 'gunbracket' || name === 'canon' || name === 'cannon');
                const isCanonSubstring = (name.includes('mount') || name.includes('gunbracket') || name.includes('canon') || name.includes('cannon') || name.includes('barrel') || name.includes('cañon'));

                // Priority: 'mount' is the best pivot.
                if (isCanonKey) {
                    if (name === 'mount') {
                        canonNode = child;
                        // We found the best possible pivot, we could even stop here
                    } else if (!canonNode || canonNode.name.toLowerCase() !== 'mount') {
                        canonNode = child;
                    }
                } else if (!canonNode && isCanonSubstring) {
                    canonNode = child;
                }
            });
        }

        if (turretNode) console.log(`[TANK-DEBUG] 🗼 Torreta: ${turretNode.name}`);
        if (canonNode) console.log(`[TANK-DEBUG] 🔫 Cañón: ${canonNode.name}`);

        if (vehicleWheels.length > 0) {
            console.log(`🏍️ Auto-Detected ${vehicleWheels.length} Wheels for Spinning on ${type}.`);
        }

        const vehicle = {
            id: id || `vehicle_${type}`,
            mesh: model,
            type: type,
            velocity: 0,
            steering: 0,
            wheels: vehicleWheels,
            turret: turretNode,
            canon: canonNode,
            collider: new THREE.Box3().setFromObject(model),
            raycaster: new THREE.Raycaster(), // For collision
            engineSoundStartup: null,
            engineSoundDrive: null,
            soundTimer: 0, // Track time for transition
            isCrushed: false,
            crushTimer: 0,
            pushVelocity: new THREE.Vector3(0, 0, 0),
            originalScaleY: model.scale.y,
            health: type === 'tank' ? 2 : 1,
            isSmoking: false,
            isPunctured: { front: false, back: false },
            isTippedOver: false,
            glassHits: 0,
            isGlassBroken: false,
            halfHeight: model.userData.halfHeight || 0,
            angularVelocity: 0 // For smooth helicopter turns
        };
        // Use a WeakMap for original emissives to handle shared materials globally
        if (!this.originalEmissives) this.originalEmissives = new WeakMap();

        // Attach Engine Sound Tracker (3D Positional Audio)
        if (this.characterController && this.characterController.world && this.characterController.world.audioListener) {
            const listener = this.characterController.world.audioListener;
            const startupSound = new THREE.PositionalAudio(listener);
            const driveSound = new THREE.PositionalAudio(listener);

            vehicle.engineSoundStartup = startupSound;
            vehicle.engineSoundDrive = driveSound;
            model.add(startupSound);
            model.add(driveSound);

            // Dynamic Loader: Load correct engine sound per type
            let sFile, dFile;
            if (type === 'tank') {
                sFile = 'tank-moving.mp3';
                dFile = 'tank-moving.mp3';
            } else if (type === 'helicopter') {
                sFile = 'helicopterHelice1.mp3';
                dFile = 'helicopterHelice1.mp3';
            } else {
                sFile = 'motorcycle.mp3';
                dFile = 'motorcycle.mp3'; // Using same for now for simplicity
            }

            this.audioLoader.load(`sounds/${sFile}?v=${Date.now()}`, (buffer) => {
                startupSound.setBuffer(buffer);
                startupSound.setRefDistance(10);
                startupSound.setMaxDistance(50);
                startupSound.setLoop(false);
                startupSound.setVolume(0);
            });

            this.audioLoader.load(`sounds/${dFile}?v=${Date.now()}`, (buffer) => {
                driveSound.setBuffer(buffer);
                driveSound.setRefDistance(10);
                driveSound.setMaxDistance(50);
                driveSound.setLoop(true);
                driveSound.setVolume(0);
            });
        }

        this.scene.add(model);
        this.vehicles.push(vehicle);

        // Motorcycle specific: Add headlight (REMOVED FOR PERFORMANCE)
        if (type === 'motorcycle') {
            vehicle.isHeadlightOn = false;
        }

        // Helicopter specific: identify rotors
        if (type === 'helicopter') {
            vehicle.rotors = [];
            vehicle.tailRotors = []; // Separate tail rotors for correct axis rotation

            // CRITICAL: Update matrices so getWorldPosition works during traversal
            model.updateMatrixWorld(true);

            model.traverse(child => {
                const n = child.name.toLowerCase();

                // 1. DETECCIÓN POR NOMBRES ESPECÍFICOS (Visto en el Inspector)
                // Rotor Principal: Buscamos 'cylinder_10' o 'Object_38'
                const isMainRotorNode = n.includes('cylinder_10') || n.includes('object_38');

                // Rotor de Cola: Buscamos 'object_47' o el nodo que lo contiene
                const isTailRotorNode = n.includes('object_47');

                if (isMainRotorNode) {
                    // Si es un nodo de hélice, nos aseguramos de rotar SOLO las mallas (Meshes)
                    // para evitar rotar nodos padres que contengan la cabina.
                    child.traverse(c => {
                        if (c.isMesh && !vehicle.rotors.includes(c)) {
                            vehicle.rotors.push(c);
                            console.log(`[HELI-FIX] Malla Rotor Principal aislada: "${c.name}"`);
                        }
                    });
                } else if (isTailRotorNode) {
                    child.traverse(c => {
                        if (c.isMesh && !vehicle.tailRotors.includes(c)) {
                            vehicle.tailRotors.push(c);
                            console.log(`[HELI-FIX] Malla Rotor de Cola aislada: "${c.name}"`);
                        }
                    });
                }
            });

            console.log(`[HELI] Final Detection: ${vehicle.rotors.length} main, ${vehicle.tailRotors.length} tail meshes.`);
            vehicle.rotorAccel = 0; // State for gradual startup (0 to 1)
        }

        return vehicle;
    }

    findNearestVehicle(position, range = 3.0) {
        let nearest = null;
        let minDist = range * range;

        for (const v of this.vehicles) {
            const distSq = v.mesh.position.distanceToSquared(position);
            if (distSq < minDist) {
                minDist = distSq;
                nearest = v;
            }
        }
        return nearest;
    }

    isArmor(mesh) {
        if (!mesh) return false;
        let found = false;
        mesh.traverse(c => {
            const name = c.name.toLowerCase();
            // All tanks have these nodes or name
            if (name.includes('turret') || name.includes('canon') || name.includes('barrel') || name.includes('tank')) {
                found = true;
            }
        });
        return found;
    }

    findVehicleByMesh(mesh) {
        if (!mesh) return null;
        // Search in managed vehicles
        for (const v of this.vehicles) {
            let temp = mesh;
            while (temp) {
                if (temp === v.mesh) return v;
                temp = temp.parent;
            }
        }

        // Check in NPC cars (simple meshes)
        if (this.characterController && this.characterController.world && this.characterController.world.npcManager) {
            const npcCar = this.characterController.world.npcManager.cars.find(car => {
                let temp = mesh;
                while (temp) {
                    if (temp === car) return true;
                    temp = temp.parent;
                }
                return false;
            });
            if (npcCar) return npcCar;
        }

        // Check in Dynamic NPCs
        if (this.dynamicNPCs) {
            const dynCar = this.dynamicNPCs.find(car => {
                let temp = mesh;
                while (temp) {
                    if (temp === car) return true;
                    temp = temp.parent;
                }
                return false;
            });
            if (dynCar) return dynCar;
        }

        // NEW: Check if it's a part of the city environment that looks like a vehicle
        let temp = mesh;
        while (temp) {
            const n = temp.name ? temp.name.toLowerCase() : '';
            // Match common vehicle names in GLTF models
            if (n.includes('bus') || n.includes('car') || n.includes('van') || n.includes('truck') || n.includes('auto') || n.includes('veh') || n.includes('tank') || n.includes('transporter') || n.includes('wreck') || n.includes('zuk')) {
                // If we found a match, but it's not the root scene itself
                if (temp.parent && temp.parent !== this.scene) {
                    return temp;
                }
            }
            if (temp.parent === this.scene) break;
            temp = temp.parent;
        }

        return null;
    }

    enterVehicle(vehicle) {
        if (!vehicle || this.currentVehicle) return;

        // If connected to multiplayer network, request permission first
        const net = this.characterController?.world?.networkManager;
        if (net && net.socket && net.socket.connected) {
            this.pendingVehicleToEnter = vehicle; // Store to execute upon success
            net.socket.emit('requestEnterVehicle', { vehicleId: vehicle.id });
            console.log(`[VEHICLE] Requesting entry to server for vehicle: ${vehicle.id}`);
            return;
        }

        // Fallback for single-player / offline
        this.executeEnterVehicle(vehicle);
    }

    executeEnterVehicle(vehicle) {
        this.currentVehicle = vehicle;

        // Resume context if suspended (Browser autoplay policy)
        if (vehicle.engineSoundDrive && vehicle.engineSoundDrive.context && vehicle.engineSoundDrive.context.state === 'suspended') {
            vehicle.engineSoundDrive.context.resume();
        }

        // Start Engine Sound sequence
        vehicle.soundTimer = 0; 
        if (vehicle.engineSoundDrive && !vehicle.engineSoundDrive.isPlaying) {
            vehicle.engineSoundDrive.play();
            vehicle.engineSoundDrive.setVolume(0.4);
        }

        // Notify Character Controller
        this.characterController.setDriving(true, vehicle);
    }

    exitVehicle() {
        if (!this.currentVehicle) return;

        const v = this.currentVehicle;
        const isTank = v.type === 'tank';
        const isHeli = v.type === 'helicopter';
        // Aumentamos la distancia para que el jugador aterrice bien separado del chasis del vehículo
        const sideOffset = isTank ? 5.0 : (isHeli ? 4.0 : 2.5);

        // Calculate exit position to the left of the vehicle
        const left = new THREE.Vector3(-1.0, 0, 0).applyQuaternion(v.mesh.quaternion);
        const exitPos = v.mesh.position.clone().add(left.multiplyScalar(sideOffset));

        // --- BUILT-IN GROUND SNAPPING FOR EXIT ---
        // Raycast down from slightly above the calculated exit position
        const rayOrigin = exitPos.clone().add(new THREE.Vector3(0, 5, 0));
        const rayDir = new THREE.Vector3(0, -1, 0);
        const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0, 10);

        const colliders = this.characterController.colliders || [];
        const hits = raycaster.intersectObjects(colliders, true);

        if (hits.length > 0) {
            exitPos.y = hits[0].point.y + 0.05; // Snap to ground with tiny buffer
        } else {
            // Fallback: stay at vehicle height but at least above zero
            exitPos.y = Math.max(0.1, v.mesh.position.y);
        }

        // Mute Engine Sound
        if (v.engineSoundStartup && v.engineSoundStartup.isPlaying) {
            v.engineSoundStartup.setVolume(0);
            v.engineSoundStartup.stop();
        }
        if (v.engineSoundDrive && v.engineSoundDrive.isPlaying) {
            v.engineSoundDrive.setVolume(0);
            v.engineSoundDrive.pause();
        }

        // Obtener la posición real del vehículo ANTES de desvincular el personaje
        const vehiclePos = v.mesh.position.clone();
        const vehicleYaw = v.mesh.rotation.y;

        // Reset vehicle inputs so it doesn't fly away by itself
        v.isElevating = false;
        v.isDescending = false;
        v.velocity = 0;

        // We no longer instantly snap the helicopter here. 
        // The update loop will now apply a smooth descent when unoccupied.

        this.characterController.setDriving(false, null, exitPos);
        this.currentVehicle = null;

        // Notify Server that we exited the vehicle and tell them the final position/yaw of the VEHICLE (not the player)
        const net = this.characterController?.world?.networkManager;
        if (net && net.socket && net.socket.connected) {
            net.socket.emit('exitVehicle', {
                vehicleId: v.id,
                x: vehiclePos.x,
                y: vehiclePos.y,
                z: vehiclePos.z,
                yaw: vehicleYaw
            });
        }
    }

    crushVehicle(v) {
        if (v.isCrushed) return;
        v.isCrushed = true;
        v.crushTimer = 0;

        // Visual Explosion
        if (this.characterController && this.characterController.weaponManager) {
            this.characterController.weaponManager.createExplosion(v.mesh.position, 2.0);

            // Screen Shake
            if (this.characterController.shakeCamera) {
                this.characterController.shakeCamera(0.5, 0.4);
            }

            // Sound
            if (this.characterController.weaponManager.soundManager) {
                this.characterController.weaponManager.soundManager.playTankCrush();
            }
        }

        // If it's the current vehicle, force exit and KILL driver instantly!
        if (this.currentVehicle === v) {
            if (this.characterController && !this.characterController.isDead) {
                this.characterController.takeDamage(3); // 3 damage = Instant Death!
            }
            this.exitVehicle();
        }
    }

    damageVehicle(v, amount = 1, hitMesh = null, isHeli = false) {
        if (!v || v.isCrushed) return;

        // LIGHT WEAPONS RESTRICTIONS (Pistols, Rifles, Snipers)
        const isHeavyExplosive = (amount >= 0.5);
        
        // Tanks, Helicopters, and Transporters (buses/cars) are IMMUNE to light weapon damage to the body.
        // Only bazookas/missiles (heavy explosives) can destroy them.
        if (!isHeavyExplosive && v.type !== 'motorcycle') {
            console.log(`🛡️ ${v.type || 'Vehicle'} is immune to light weapon damage!`);
            
            // SPECIAL CASE: Helicopter Glass
            if (v.type === 'helicopter' && hitMesh) {
                const name = hitMesh.name.toLowerCase();
                const isTransparent = hitMesh.material && (hitMesh.material.transparent || hitMesh.material.opacity < 0.9);
                
                if (name.includes('object_8') || name.includes('object_9') || isTransparent) {
                    if (!v.isGlassBroken) {
                        v.glassHits++;
                        console.log(`💎 Heli Glass Hit: ${v.glassHits}/5`);
                        this.flashRed(hitMesh); // Flash only the glass
                        if (v.glassHits >= 5) {
                            v.isGlassBroken = true;
                            hitMesh.visible = false; 
                            console.log("💎 CABIN GLASS SHATTERED!");
                        }
                    }
                    return; // Return here to avoid body damage
                }
            }
            
            // Still flash red on body to show we hit it, but don't take health
            this.flashRed(v.mesh || v);
            return; 
        }

        // SPECIFIC PART DETECTION: MOTORCYCLE
        if (hitMesh && v.type === 'motorcycle') {
            const name = hitMesh.name.toLowerCase();
            
            // 1. GAS TANK (Instant Explosion)
            if (name.includes('azul_0')) {
                console.log("💥 FUEL TANK HIT! KABOOM!");
                this.crushVehicle(v);
                return;
            }

            // 2. WHEELS (Punctures)
            if (name.includes('tire') || name.includes('negro_0')) {
                if (name.includes('f_tire')) v.isPunctured.front = true;
                if (name.includes('b_tire')) v.isPunctured.back = true;
                console.log("🛞 TIRE PUNCTURED!");
                this.spawnSmokeParticle(hitMesh.getWorldPosition(new THREE.Vector3()), 0.5);
            }
        }

        // 3. TIPPING OVER (If parked)
        if (!this.currentVehicle || this.currentVehicle !== v) {
            if (amount > 0.1 && v.type === 'motorcycle' && !v.isTippedOver) {
                v.isTippedOver = true;
                console.log("🏍️ Motorcycle tipped over!");
            }
        }

        // NPC DETECTION & ENGINE LOGIC
        const isManaged = this.vehicles.find(veh => veh === v);

        if (!isManaged) {
            // NPC car or tank
            if (this.isArmor(v)) {
                if (v.health === undefined) v.health = 2;
                v.health -= amount;
                if (v.health <= 0) this.crushNPC(v);
                else {
                    v.isSmoking = true;
                    // Logic for permanent red on NPC tanks
                    if (isHeli) {
                        if (amount >= 0.9) v.stayRed = true; // Missile
                        if (amount === 0.1) {
                            if (v.heliHits === undefined) v.heliHits = 0;
                            v.heliHits++;
                            if (v.heliHits >= 5) v.stayRed = true;
                        }
                    }
                    this.flashRed(v, v.stayRed);
                }
            } else {
                // NPC CAR
                // Check if hit tires
                if (hitMesh && hitMesh.name.toLowerCase().includes('object_')) {
                    const n = hitMesh.name.toLowerCase();
                    if (n === 'object_15' || n === 'object_18' || n === 'object_21' || n === 'object_24') {
                        v.isPunctured = true; // NPC cars just stop
                        console.log("🛞 NPC Car Tire Punctured!");
                        return;
                    }
                }

                // TACTICAL urban cover: small arms (pistols, rifles, snipers) do not destroy NPC cars/buses
                const isHeavyExplosive = (amount >= 0.5);

                if (!isHeavyExplosive) {
                    // Flash red to indicate hit visual feedback, but deflect bullet completely
                    this.flashRed(v.mesh || v);
                    console.log(`🛡️ NPC cover deflected bullet (amount: ${amount})`);
                    return;
                }

                // Heavy weapons (Tank Shells, Bomber Bombs, Heli Missiles) destroy NPC cars/buses
                if (isHeli) {
                    if (amount >= 0.9) v.stayRed = true;
                    if (amount === 0.1) {
                        if (v.heliHits === undefined) v.heliHits = 0;
                        v.heliHits++;
                        if (v.heliHits >= 5) v.stayRed = true;
                    }
                }
                this.crushNPC(v);
            }
            return;
        }

        v.health -= amount;
        if (v.health <= 0) {
            this.crushVehicle(v);
        } else {
            console.log(`[COMBAT] Damage applied to ${v.type}. Health: ${v.health}`);
            v.isSmoking = true;
            
            // Logic for permanent red on Managed Vehicles from Heli
            if (isHeli) {
                if (amount >= 0.9) v.stayRed = true; // Missile
                if (amount === 0.1) {
                    if (v.heliHits === undefined) v.heliHits = 0;
                    v.heliHits++;
                    if (v.heliHits >= 5) v.stayRed = true;
                }
            }

            this.flashRed(v.mesh || v, v.stayRed);
        }
    }

    flashRed(target, stayRed = false) {
        if (!target) return;
        const root = target.isMesh ? target : target.mesh || target;
        if (!root) return;

        root.traverse(c => {
            // SKIP bullet holes so they don't disappear or turn red
            if (c.userData.type === 'impact_part') return;

            if (c.isMesh && c.material) {
                const mats = Array.isArray(c.material) ? c.material : [c.material];
                mats.forEach((m) => {
                    if (m.emissive) {
                        // Use the global WeakMap on this instance to store original colors
                        if (!this.originalEmissives.has(m)) {
                            this.originalEmissives.set(m, m.emissive.clone());
                        }

                        m.emissive.setHex(0xff0000);
                        
                        if (!stayRed) {
                            setTimeout(() => {
                                if (m.emissive && this.originalEmissives.has(m)) {
                                    m.emissive.copy(this.originalEmissives.get(m));
                                }
                            }, 2000);
                        }
                    }
                });
            }
        });
    }

    crushNPC(car) {
        if (this.characterController.weaponManager) {
            const worldPos = car.getWorldPosition(new THREE.Vector3());
            this.characterController.weaponManager.createExplosion(worldPos, 2.0);
            if (this.characterController.weaponManager.soundManager) {
                this.characterController.weaponManager.soundManager.playTankCrush();
            }
        }
        if (this.characterController.shakeCamera) this.characterController.shakeCamera(0.4, 0.3);

        // Remove from NPC manager if exists
        if (this.characterController.world && this.characterController.world.npcManager) {
            const index = this.characterController.world.npcManager.cars.indexOf(car);
            if (index !== -1) this.characterController.world.npcManager.cars.splice(index, 1);
        }

        if (this.dynamicNPCs) {
            const index = this.dynamicNPCs.indexOf(car);
            if (index !== -1) this.dynamicNPCs.splice(index, 1);
        }

        // Cleanup from colliders to prevent invisible walls
        if (this.characterController && this.characterController.colliders) {
            const meshesToRemove = new Set();
            car.traverse(c => meshesToRemove.add(c));
            this.characterController.colliders = this.characterController.colliders.filter(c => !meshesToRemove.has(c));
            if (this.characterController.world) {
                this.characterController.world.updateRemoteColliders();
            }
        }

        if (car.parent) {
            car.parent.remove(car);
        } else {
            this.scene.remove(car);
        }
    }

    pushVehicle(v, dir, force = 5.0) {
        if (v.isCrushed) return;
        // Apply impulse to pushVelocity
        const impulse = dir.clone().normalize().multiplyScalar(force);
        v.pushVelocity.add(impulse);
    }

    pushVehicleNPC(car, dir, force = 5.0) {
        // Initialize dynamic physics state and extract from city mesh if needed
        if (!car.isDynamicPhysics) {
            car.isDynamicPhysics = true;
            car.pushVelocity = new THREE.Vector3(0, 0, 0);
            
            // If it's a child of the city, detach it to the scene to maintain physics consistency
            if (car.parent !== this.scene) {
                this.scene.attach(car); 
            }
            
            if (!this.dynamicNPCs) this.dynamicNPCs = [];
            if (!this.dynamicNPCs.includes(car)) this.dynamicNPCs.push(car);
        }
        
        const impulse = dir.clone().normalize().multiplyScalar(force);
        car.pushVelocity.add(impulse);
    }

    checkVehicleManslaughter(v) {
        // Only run over players if WE are driving the vehicle (local authority)
        if (this.characterController && this.characterController.vehicle === v) {
            const myPos = v.mesh.position;
            const hitRadius = v.type === 'tank' ? 4.0 : 2.5; // Tanks have larger hit radius
            
            if (this.characterController.world && this.characterController.world.remotePlayers) {
                for (let id in this.characterController.world.remotePlayers) {
                    const rp = this.characterController.world.remotePlayers[id];
                    // If remote player is on foot and alive
                    if (rp.mesh && !rp.currentVehicleType && rp.state !== 'dead') {
                        if (rp.mesh.position.distanceTo(myPos) < hitRadius) {
                            // Cooldown of 1 second to prevent spamming
                            if (!rp.lastRunOverTime || (Date.now() - rp.lastRunOverTime) > 1000) {
                                rp.lastRunOverTime = Date.now();
                                const hits = v.type === 'tank' ? 3 : 1; // 3 hits = Instant Death, 1 hit = fractional damage
                                console.log(`🚗💥 Atropellaste a ${rp.id} con ${v.type}! Emitiendo ${hits} golpes.`);
                                
                                // Send hits via network to trigger global AOE damage at their location
                                for (let i = 0; i < hits; i++) {
                                    setTimeout(() => {
                                        if (this.characterController.world.networkManager) {
                                            // Scale = 2.0 for big blood effect
                                            this.characterController.world.networkManager.sendHit(rp.mesh.position, 'blood', 2.0);
                                        }
                                    }, i * 50); // Stagger network packets
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    update(dt, input) {
        // 0. CHECK CANISTER COLLISIONS (NEW MECHANIC: Crash = Explosion)
        const canisters = this.characterController?.world?.explosiveCanisters || [];
        
        // Helper to check collision
        const checkVehicleAgainstCanisters = (vMesh, onHit) => {
            for (let j = canisters.length - 1; j >= 0; j--) {
                const can = canisters[j];
                if (!can.visible) continue;
                
                const dist = vMesh.position.distanceTo(can.position);
                if (dist < 2.5) { // Collision Radius
                    // 1. Explode Canister
                    if (this.characterController?.weaponManager) {
                        this.characterController.weaponManager.createExplosion(can.position, 1.5);
                    }
                    can.visible = false;
                    this.scene.remove(can);
                    canisters.splice(j, 1);
                    
                    // 2. Trigger Vehicle Explosion
                    onHit();
                }
            }
        };

        // 1. UPDATE ALL MANAGED VEHICLES (Physics/Anims)
        for (let i = this.vehicles.length - 1; i >= 0; i--) {
            const v = this.vehicles[i];
            


            // Check collisions if moving
            if (Math.abs(v.velocity) > 1.0 && !v.isCrushed) {
                checkVehicleAgainstCanisters(v.mesh, () => this.crushVehicle(v));
                if (Math.abs(v.velocity) > 5.0) {
                    this.checkVehicleManslaughter(v);
                }
            }

            // A) CRUSH ANIMATION
            if (v.isCrushed) {
                v.crushTimer += dt;
                // Squeeze on Y axis
                const targetScaleY = 0.05 * v.originalScaleY;
                v.mesh.scale.y = THREE.MathUtils.lerp(v.mesh.scale.y, targetScaleY, dt * 5.0);

                // After 2 seconds, remove from scene
                if (v.crushTimer > 2.0) {
                    this.scene.remove(v.mesh);
                    this.vehicles.splice(i, 1);
                    continue;
                }
            }

            // B) PUSH VELOCITY (Friction/Application with Collision Check)
            if (v.pushVelocity.length() > 0.01) {
                const moveDir = v.pushVelocity.clone().normalize();
                const ray = new THREE.Raycaster(v.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)), moveDir);
                ray.far = 1.5;
                const hits = ray.intersectObjects(this.characterController.colliders, true);
                
                if (hits.length === 0) {
                    v.mesh.position.add(v.pushVelocity.clone().multiplyScalar(dt));
                } else {
                    v.pushVelocity.set(0, 0, 0); // Stop if hit wall
                }
                v.pushVelocity.multiplyScalar(Math.max(0, 1.0 - dt * 4.0)); // Friction
            }

            // C) SMOKE PARTICLES
            if (v.isSmoking && !v.isCrushed) {
                this.spawnSmokeParticle(v.mesh.position);
            }
        }

        // 1.5 UPDATE NPC CARS (Smoke & Pushing)
        const updateNPCPhysics = (car) => {
            if (!car) return;
            // Apply Pushing and Gravity ONLY when moving
            let isMoving = false;
            if (car.pushVelocity && car.pushVelocity.length() > 0.01) {
                const moveDir = car.pushVelocity.clone().normalize();
                const ray = new THREE.Raycaster(car.position.clone().add(new THREE.Vector3(0, 1.0, 0)), moveDir);
                ray.far = 1.5;
                const hits = ray.intersectObjects(this.characterController.colliders, true);
                
                // Filter hits to ignore the car itself
                const obstacleHits = hits.filter(h => {
                    let p = h.object;
                    while(p) {
                        if (p === car) return false;
                        p = p.parent;
                    }
                    return true;
                });
                
                if (obstacleHits.length === 0) {
                    car.position.add(car.pushVelocity.clone().multiplyScalar(dt));
                } else {
                    car.pushVelocity.set(0, 0, 0);
                }
                car.pushVelocity.multiplyScalar(Math.max(0, 1.0 - dt * 4.0));
                isMoving = true;

                // NPC Collision with canisters
                checkVehicleAgainstCanisters(car, () => this.crushNPC(car));
            }

            // PERFORMANCE FIX: Only raycast the scenery IF the car is actively being pushed or is currently in the air!
            if (isMoving || car.position.y > 0.5) {
                const groundRay = new THREE.Raycaster(car.position.clone().add(new THREE.Vector3(0, 2, 0)), new THREE.Vector3(0, -1, 0));
                const groundHits = groundRay.intersectObjects(this.characterController.colliders, true);
                if (groundHits.length > 0 && Math.abs(car.position.y - groundHits[0].point.y) < 3.0) {
                    car.position.y = groundHits[0].point.y;
                } else {
                    car.position.y -= 15.0 * dt; // Fall
                    if (car.position.y < 0) car.position.y = 0;
                }
            }
            
            // Apply Smoke for damaged NPC tanks
            if (car.health === 1 || car.isSmoking || car.pistolHits > 15) {
                this.spawnSmokeParticle(car.position);
            }
            
            // Stop NPC car if punctured
            if (car.isPunctured) {
                if (!car.pushVelocity) car.pushVelocity = new THREE.Vector3();
            }
        };

        if (this.characterController.world && this.characterController.world.npcManager) {
            const npcCars = this.characterController.world.npcManager.cars;
            for (const car of npcCars) {
                updateNPCPhysics(car);
            }
        }
        
        if (this.dynamicNPCs) {
            for (const car of this.dynamicNPCs) {
                updateNPCPhysics(car);
            }
        }

        // 2. ACTIVE DRIVER LOGIC
        if (this.currentVehicle && this.characterController.isDriving) {
            const v = this.currentVehicle;
            const cfg = this.settings[v.type];

            // --- SANITY CHECK ---
            if (!isFinite(v.velocity)) v.velocity = 0;
            if (!isFinite(v.mesh.rotation.y)) v.mesh.rotation.y = 0;
            if (!isFinite(v.mesh.position.x) || !isFinite(v.mesh.position.z)) {
                console.warn(`[VehicleManager] ${v.type} position NaN! Rescuing.`);
                if (this.characterController && this.characterController.mesh && (!this.characterController.isDriving || this.currentVehicle !== v)) {
                    v.mesh.position.copy(this.characterController.mesh.position);
                    v.mesh.position.x += 5; // Rescatarlo a 5 metros del jugador
                } else {
                    v.mesh.position.set(-300, 0.5, 0); // Posición segura por defecto (donde spawnea)
                }
            }
            // Acceleration
            let maxSpeed = cfg.speed;
            
            // Penalty for punctured wheels
            if (v.type === 'motorcycle') {
                if (v.isPunctured.front) maxSpeed *= 0.6;
                if (v.isPunctured.back) maxSpeed *= 0.6;
                if (v.isTippedOver) maxSpeed = 0; // Cannot move if tipped over
            }

            if (input.y !== 0) {
                v.velocity = THREE.MathUtils.lerp(v.velocity, input.y * maxSpeed, dt * 2);
            } else {
                v.velocity = THREE.MathUtils.lerp(v.velocity, 0, dt * 5); // Friction
            }

            // Rotate wheels
            if (v.wheels && v.wheels.length > 0) {
                // Determine rotation based on velocity and average wheel radius (e.g. 0.35m)
                const wheelRotation = (v.velocity * dt) / 0.35;
                v.wheels.forEach(wheel => {
                    wheel.rotation.x += wheelRotation;
                });
            }

            // Engine Sound Transition & Modulation
            v.soundTimer += dt;
            const transitionTime = 10.0; // 10 seconds for the startup sound

            // Check if it's time to transition
            if (v.soundTimer >= transitionTime) {
                if (v.engineSoundStartup && v.engineSoundStartup.isPlaying) {
                    v.engineSoundStartup.stop();
                }
                if (v.engineSoundDrive && !v.engineSoundDrive.isPlaying) {
                    v.engineSoundDrive.play();
                    v.engineSoundDrive.setVolume(0.4);
                }
            }

            // Modulate the *active* sound based on driving speed
            const activeSound = v.soundTimer < transitionTime ? v.engineSoundStartup : v.engineSoundDrive;
            if (activeSound && activeSound.isPlaying) {
                const speedMagnitude = Math.abs(v.velocity);
                const maxSpeed = cfg.speed;
                // Pitch goes from 1.0 (idle) to 2.5 (top speed)
                let pitch = 1.0;
                if (maxSpeed > 0) {
                    pitch = 1.0 + (speedMagnitude / maxSpeed) * 1.5;
                }

                // SAFETY: AudioParam requires a finite number
                if (!isFinite(pitch)) pitch = 1.0;

                activeSound.setPlaybackRate(pitch);
            }

            // Turning
            let targetLean = 0; // Z-axis rotation

            // Tanks can turn in place (Neutral Steering)
            const isTank = v.type === 'tank';
            let isHeli = v.type === 'helicopter';
            const minimumVelocityToTurn = (isTank || isHeli) ? -100 : 0.1;

            if (Math.abs(v.velocity) > minimumVelocityToTurn) {
                // For neutral steering, if v.velocity is 0, we treat it as 1.0 for directionality
                const directionality = ((isTank || isHeli) && Math.abs(v.velocity) < 0.1) ? 1.0 : Math.sign(v.velocity);

                if (isHeli) {
                    // MOUSE CONTROLLED HELICOPTER:
                    // The camera freely rotates via mouse, and the helicopter body catches up.
                    let targetYaw = this.characterController ? this.characterController.yaw : v.mesh.rotation.y;

                    // Allow keyboard (A/D) to still turn the camera & heli
                    if (input.x !== 0 && this.characterController) {
                        this.characterController.yaw -= input.x * cfg.turnSpeed * dt;
                        this.characterController.aimYaw -= input.x * cfg.turnSpeed * dt;
                        targetYaw = this.characterController.yaw;
                    }

                    // Calculate shortest angle to target
                    let diff = targetYaw - v.mesh.rotation.y;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    while (diff > Math.PI) diff -= Math.PI * 2;

                    // Add inertia
                    const targetAngVel = diff * 4.0;
                    const lerpFactor = 4.0;
                    v.angularVelocity = THREE.MathUtils.lerp(v.angularVelocity, targetAngVel, dt * lerpFactor);
                    v.mesh.rotation.y += v.angularVelocity * dt;
                } else {
                    // Standard Snappy Turning for Land Vehicles
                    let turn = input.x * cfg.turnSpeed * dt;
                    v.mesh.rotation.y -= turn;
                }

                // Camera Follow: Reference implementation (Yaw subtracts turn)
                if (!isHeli && this.characterController) {
                    const actualTurn = input.x * cfg.turnSpeed * dt;
                    this.characterController.yaw -= actualTurn;
                    this.characterController.aimYaw -= actualTurn;
                }

                // Calculate leaning if it's a motorcycle
                if (v.type === 'motorcycle') {
                    // Lean amount depends on how fast we are going and how hard we are turning
                    // Max lean at high speeds: ~30 degrees (about PI/6)
                    const speedRatio = Math.min(Math.abs(v.velocity) / cfg.speed, 1.0);
                    targetLean = input.x * speedRatio * (Math.PI / 5); // Lean into the turn
                }
            }

            // Smoothly animate the lean (lerp)
            // If tipped over, lock to 90 degrees (Math.PI / 2)
            const finalLean = v.isTippedOver ? (Math.PI / 2.2) : targetLean; 
            v.mesh.rotation.z = THREE.MathUtils.lerp(v.mesh.rotation.z, finalLean, dt * 5.0);

            // --- CANISTER COLLISION (EXPLOSIVE BOMBONAS) ---
            if (this.characterController.weaponManager && this.characterController.weaponManager.canisters) {
                const wm = this.characterController.weaponManager;
                const vPos = v.mesh.position;
                const checkRadius = (v.type === 'tank' ? 5.0 : 2.5); // Larger for tank
                const speedMag = Math.abs(v.velocity);

                if (speedMag > 2.0) { // Only explode if moving at reasonable speed
                    for (let i = wm.canisters.length - 1; i >= 0; i--) {
                        const can = wm.canisters[i];
                        if (can.exploded) continue;
                        const dist = vPos.distanceTo(can.mesh.position);
                        if (dist < checkRadius) {
                            console.log("💣 VEHICLE IMPACT EXPLOSION!");
                            wm.explodeCanister(can);
                        }
                    }
                }
            }

            // Tank Mechanics: Enhanced Crushing and Pushing
            if (isTank) {
                const crushDist = 5.0;
                const pushDist = 7.0;
                const speedMag = Math.abs(v.velocity);

                // Check collisions with other managed vehicles
                for (let i = this.vehicles.length - 1; i >= 0; i--) {
                    const ov = this.vehicles[i];
                    if (ov === v || ov.isCrushed) continue;

                    const dist = v.mesh.position.distanceTo(ov.mesh.position);

                    if (dist < pushDist) {
                        const toOther = ov.mesh.position.clone().sub(v.mesh.position).normalize();

                        // Decide: Crush vs Push
                        if (ov.type !== 'tank' && speedMag > 3.0 && dist < crushDist) {
                            // Forward direction check (roughly frontal)
                            const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(v.mesh.quaternion); // Tank forward is X
                            const dot = forward.dot(toOther);
                            if (dot > 0.5) {
                                this.crushVehicle(ov);
                            } else {
                                this.pushVehicle(ov, toOther, speedMag * 0.5);
                            }
                        } else if (dist < crushDist) {
                            // Just a push or Tank-on-Tank
                            if (ov.type === 'tank') {
                                // Tank vs Tank: Screen Shake + Sparks
                                if (speedMag > 2.0 && this.characterController.shakeCamera) {
                                    this.characterController.shakeCamera(0.2, 0.2);
                                    if (this.characterController.weaponManager) {
                                        const hitPoint = v.mesh.position.clone().add(toOther.clone().multiplyScalar(dist * 0.5));
                                        this.characterController.weaponManager.createImpact(hitPoint, toOther, 'spark', 2.0);
                                    }
                                }
                            } else {
                                this.pushVehicle(ov, toOther, speedMag * 0.8);
                            }
                        }
                    }
                }

                // Handle NPC Cars (Limited "crushing" as they aren't Managed Vehicles)
                if (this.characterController.world && this.characterController.world.npcManager) {
                    const npcCars = this.characterController.world.npcManager.cars;
                    for (let i = npcCars.length - 1; i >= 0; i--) {
                        const car = npcCars[i];
                        if (!car) continue;
                        const dist = v.mesh.position.distanceTo(car.position);
                        if (dist < crushDist || dist < pushDist) {
                            const carMesh = car;
                            const targetVeh = this.findVehicleByMesh(carMesh);

                            if (targetVeh) {
                                const isManagedTarget = targetVeh.mesh !== undefined;
                                const actualMesh = isManagedTarget ? targetVeh.mesh : targetVeh;

                                if (actualMesh !== v.mesh) {
                                    const worldPos = actualMesh.getWorldPosition(new THREE.Vector3());
                                    const toCar = worldPos.clone().sub(v.mesh.position).normalize();

                                    if (dist < crushDist && speedMag > 1.0) {
                                        if (this.isArmor(actualMesh)) {
                                            // Tank on Tank collision: Push only
                                            if (!isManagedTarget) this.pushVehicleNPC(actualMesh, toCar, speedMag * 0.5);
                                        } else {
                                            // Push buses and cars instead of crushing them
                                            if (!isManagedTarget) this.pushVehicleNPC(actualMesh, toCar, speedMag * 1.5);
                                        }
                                    } else if (dist < pushDist && speedMag > 1.0) {
                                        if (!isManagedTarget) this.pushVehicleNPC(actualMesh, toCar, speedMag * 0.8);
                                    }
                                }
                            }
                        }
                    }
                }

                // 4. ANIMATE TURRET AND CANNON (Vector-Based Projection)
                if (v.turret || v.canon) {
                    const worldGoalDir = new THREE.Vector3();
                    if (this.characterController && this.characterController.camera) {
                        this.characterController.camera.getWorldDirection(worldGoalDir);
                    } else {
                        worldGoalDir.set(0, 0, -1);
                    }
                    const aimPoint = v.mesh.position.clone().add(worldGoalDir.multiplyScalar(300));

                    if (v.turret) {
                        v.turret.parent.updateMatrixWorld(true);
                        const localGoal = v.turret.parent.worldToLocal(aimPoint.clone());
                        const targetYaw = Math.atan2(localGoal.y, localGoal.x);
                        let diffY = targetYaw - v.turret.rotation.z;
                        while (diffY < -Math.PI) diffY += Math.PI * 2;
                        while (diffY > Math.PI) diffY -= Math.PI * 2;
                        const maxTurn = Math.PI * dt;
                        v.turret.rotation.z += Math.sign(diffY) * Math.min(Math.abs(diffY), maxTurn);
                    }

                    if (v.canon) {
                        v.canon.parent.updateMatrixWorld(true);
                        const localGoal = v.canon.parent.worldToLocal(aimPoint.clone());
                        const horizontalDist = Math.sqrt(localGoal.x * localGoal.x + localGoal.y * localGoal.y);
                        const targetPitch = -Math.atan2(localGoal.z, horizontalDist);
                        let diffP = targetPitch - v.canon.rotation.y;
                        while (diffP < -Math.PI) diffP += Math.PI * 2;
                        while (diffP > Math.PI) diffP -= Math.PI * 2;
                        const maxPitch = Math.PI * dt;
                        v.canon.rotation.y += Math.sign(diffP) * Math.min(Math.abs(diffP), maxPitch);
                    }
                }
            } // End of isTank block

            // 1.8 HELICOPTER FLIGHT LOGIC
            if (v.type === 'helicopter') {
                const cfg = this.settings.helicopter;

                // Vertical Collision (Find floor/roof below)
                // Since the helicopter's local origin is centered on its bottom (Y=0) in spawnVehicle,
                // minH should just be the floor height + 0.1 safety offset.
                let minH = 0.1;
                if (this.characterController && this.characterController.colliders) {
                    const downRay = new THREE.Raycaster(
                        v.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)),
                        new THREE.Vector3(0, -1, 0)
                    );
                    // Filter out the helicopter's own mesh from collision
                    const colliders = this.characterController.colliders.filter(c => c !== v.mesh);
                    const downHits = downRay.intersectObjects(colliders, true);
                    if (downHits.length > 0) {
                        minH = downHits[0].point.y + 0.1;
                    }
                }

                if (this.currentVehicle === v) {
                    // PILOTED: Allow elevation control
                    const keys = this.characterController.keys;
                    // Combine Keyboard and Gamepad inputs
                    const elevate = keys.elevate || v.isElevating;
                    const descend = keys.descend || v.isDescending;

                    if (elevate && !descend) {
                        v.mesh.position.y += cfg.liftSpeed * dt;
                    } else if (descend && !elevate) {
                        v.mesh.position.y -= cfg.liftSpeed * dt;
                    }

                    // Tilt Animation (Pitch and Roll)
                    let targetPitch = this.characterController ? this.characterController.pitch : 0;
                    if (input.y !== 0) {
                        targetPitch += (input.y > 0) ? -Math.PI / 8 : Math.PI / 8;
                    }
                    targetPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, targetPitch));
                    
                    const bankingFactor = 0.25;
                    const targetRoll = (v.angularVelocity || 0) * bankingFactor;

                    v.mesh.rotation.order = 'YXZ';
                    v.mesh.rotation.x = THREE.MathUtils.lerp(v.mesh.rotation.x, targetPitch, dt * 5.0);
                    v.mesh.rotation.z = THREE.MathUtils.lerp(v.mesh.rotation.z, targetRoll, dt * 5.0);

                } else {
                    // UNOCCUPIED: SLOW DESCENT (GRAVITY)
                    // Ensure the helicopter gently lands on the ground/roof
                    if (v.mesh.position.y > minH) {
                        v.mesh.position.y -= 8.0 * dt; // Fall speed
                    }

                    // Level out the tilt when unoccupied
                    v.mesh.rotation.order = 'YXZ';
                    v.mesh.rotation.x = THREE.MathUtils.lerp(v.mesh.rotation.x, 0, dt * 2.0);
                    v.mesh.rotation.z = THREE.MathUtils.lerp(v.mesh.rotation.z, 0, dt * 2.0);
                    
                    // Decelerate if it was moving
                    v.velocity = THREE.MathUtils.lerp(v.velocity, 0, dt * 2.0);
                }

                // Prevent falling through roofs/floor (applies to both piloted and unoccupied)
                if (v.mesh.position.y < minH) v.mesh.position.y = minH;

                // 1.8 HELICOPTER ROTOR ANIMATION
                if (v.type === 'helicopter') {
                    // Acelerar si alguien está pilotando, frenar si no
                    const isPiloted = (this.currentVehicle === v);
                    const accelSpeed = isPiloted ? 0.3 : 0.15; // Más rápido al arrancar que al frenar
                    v.rotorAccel = THREE.MathUtils.lerp(v.rotorAccel || 0, isPiloted ? 1.0 : 0, dt * accelSpeed);

                    if (v.rotorAccel > 0.01) {
                        const rotorSpeed = 60.0 * v.rotorAccel;
                        const dt_scaled = dt * rotorSpeed;

                        if (v.rotors) {
                            v.rotors.forEach(rotor => {
                                // En modelos de Sketchfab/Babylon, el eje de rotación suele ser el local Y o Z
                                // Si 'cylinder_10' es el padre, rotamos sobre su eje vertical
                                rotor.rotation.y += dt_scaled;
                            });
                        }
                        if (v.tailRotors) {
                            v.tailRotors.forEach(rotor => {
                                // Las hélices de cola suelen rotar sobre el eje X o Z local
                                rotor.rotation.x += dt_scaled;
                            });
                        }
                    }
                }
            }

            // 2. GRAVITY & GROUND SNAPPING
            if (v.type !== 'helicopter') {
                const groundRay = new THREE.Raycaster(
                    v.mesh.position.clone().add(new THREE.Vector3(0, 2, 0)), // Start ray slightly higher
                    new THREE.Vector3(0, -1, 0)
                );
                const groundHits = groundRay.intersectObjects(this.characterController.colliders, true);
                let onGround = false;
                if (groundHits.length > 0) {
                    const groundHeight = groundHits[0].point.y;
                    // Snap to ground if reasonable distance
                    if (Math.abs(v.mesh.position.y - groundHeight) < 3.0) {
                        v.mesh.position.y = groundHeight;
                        onGround = true;
                    }
                }

                // Fall down faster if not strictly on ground
                if (!onGround) {
                    v.mesh.position.y -= 25.0 * dt;
                }
            }

            // 3. COLLISION DETECTION (Improved Horizontal - Multi-Ray & Push-Out)
            // For helicopters, we only check forward movement but at a higher vertical offset
            isHeli = v.type === 'helicopter';
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
            const moveDir = forward.clone();
            if (v.velocity < 0) moveDir.negate(); // Check backward if reversing

            // Helicopters don't strafe with keys, so moveDir is always forward/back

            // Calculate side offsets for whiskers
            const rightVec = new THREE.Vector3(1, 0, 0).applyQuaternion(v.mesh.quaternion);
            const leftVec = rightVec.clone().negate();
            const widthOffset = isHeli ? 2.5 : 0.5; // Helicopters are wide

            // Define multiple heights to catch low curbs and high walls (like tanks)
            const heights = [0.2, 0.8, 1.5];
            const rayOrigins = [];

            heights.forEach(h => {
                rayOrigins.push(v.mesh.position.clone().add(new THREE.Vector3(0, h, 0))); // Center
                rayOrigins.push(v.mesh.position.clone().add(new THREE.Vector3(0, h, 0)).add(rightVec.clone().multiplyScalar(widthOffset))); // Right
                rayOrigins.push(v.mesh.position.clone().add(new THREE.Vector3(0, h, 0)).add(leftVec.clone().multiplyScalar(widthOffset))); // Left
            });

            let colliders = [...(this.characterController.colliders || [])];
            // Include other vehicles
            this.vehicles.forEach(ov => {
                if (ov !== v && ov.mesh) colliders.push(ov.mesh);
            });
            // Include parked cars
            if (this.characterController.world && this.characterController.world.npcManager && this.characterController.world.npcManager.cars) {
                this.characterController.world.npcManager.cars.forEach(m => {
                    if (m) colliders.push(m);
                });
            }
            let blocked = false;
            let closestDistance = 999;

            if (colliders.length > 0) {
                for (const org of rayOrigins) {
                    v.raycaster.set(org, moveDir);
                    // Dynamically set ray distance based on velocity + safety buffer
                    const checkDist = Math.max(1.5, Math.abs(v.velocity * dt) + 1.0);
                    v.raycaster.far = checkDist;

                    const hits = v.raycaster.intersectObjects(colliders, true);

                    // Filter hits: ignore ground (y < 0.1) if ray is very low, but rays are already offset up
                    const wallHits = hits.filter(h => h.distance > 0.1);

                    if (wallHits.length > 0) {
                        // Check if we hit a pushable vehicle! If so, don't block the tank!
                        const hitMesh = wallHits[0].object;
                        const targetVeh = this.findVehicleByMesh(hitMesh);
                        
                        // If it's a vehicle AND we are a tank, don't block. We push through it!
                        if (targetVeh && v.type === 'tank') {
                            const isManagedTarget = targetVeh.mesh !== undefined;
                            const actualMesh = isManagedTarget ? targetVeh.mesh : targetVeh;
                            
                            // Prevent self-pushing
                            if (actualMesh !== v.mesh) {
                                const speedMag = Math.abs(v.velocity);
                                if (speedMag > 1.0) {
                                    // Calculate push direction
                                    const worldPos = actualMesh.getWorldPosition(new THREE.Vector3());
                                    const toCar = moveDir.clone();
                                    
                                    // Push it!
                                    if (isManagedTarget) {
                                        this.pushVehicle(targetVeh, toCar, speedMag * 0.8);
                                    } else {
                                        this.pushVehicleNPC(actualMesh, toCar, speedMag * 1.5);
                                    }
                                }
                            }
                        } else {
                            blocked = true;
                            if (wallHits[0].distance < closestDistance) {
                                closestDistance = wallHits[0].distance;
                            }
                        }
                    }
                }
            }

            if (blocked) {
                v.velocity = 0; // Stop
                // Push-Out Logic: If we are already clipping (distance < bumper limit), move vehicle back
                const bumperLimit = 1.2;
                if (closestDistance < bumperLimit) {
                    const overlap = bumperLimit - closestDistance;
                    v.mesh.position.add(moveDir.clone().multiplyScalar(-overlap)); // Push out logic
                }
            }

            // Move (only if velocity not zero'd by collision)
            if (v.type === 'tank') {
                // The tank model's forward axis is actually X
                v.mesh.translateX(v.velocity * dt);
            } else if (v.type === 'helicopter') {
                // HELICOPTER FIX: Move horizontally to prevent 'diving' when tilted.
                // We also invert the sign because the model is facing backwards.
                const horizontalForward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
                horizontalForward.y = 0;
                horizontalForward.normalize();

                // Use -v.velocity because model is facing 180 degrees wrong way
                const moveVec = horizontalForward.multiplyScalar(-v.velocity * dt);

                v.mesh.position.add(moveVec);
            } else {
                v.mesh.translateZ(v.velocity * dt);
            }

            // Character position and rotation are now handled automatically by parenting
            // in CharacterController.setDriving(). No per-frame manual sync needed.
        }
    }

    spawnSmokeParticle(pos) {
        const geom = new THREE.SphereGeometry(Math.random() * 0.5 + 0.2, 8, 8);
        const mat = new THREE.MeshBasicMaterial({
            color: 0x333333,
            transparent: true,
            opacity: 0.6
        });
        const p = new THREE.Mesh(geom, mat);
        p.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2));
        this.scene.add(p);

        const startTime = Date.now();
        const duration = 1500;
        const velY = Math.random() * 2 + 1;

        const anim = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed > duration) {
                this.scene.remove(p);
                geom.dispose();
                mat.dispose();
                return;
            }
            p.position.y += velY * 0.016;
            p.scale.multiplyScalar(1.02);
            mat.opacity = 0.6 * (1 - (elapsed / duration));
            requestAnimationFrame(anim);
        };
        anim();
    }

    // --- HELICOPTER FLIGHT CONTROLS ---
    elevateHelicopter(vehicleId, isPressed) {
        const vehicle = this.vehicles.find(v => v.id === vehicleId && v.type === 'helicopter');
        if (vehicle) {
            vehicle.isElevating = isPressed;
        }
    }

    descendHelicopter(vehicleId, isPressed) {
        const vehicle = this.vehicles.find(v => v.id === vehicleId && v.type === 'helicopter');
        if (vehicle) {
            vehicle.isDescending = isPressed;
        }
    }
}
