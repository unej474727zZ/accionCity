import * as THREE from 'three';

export class VehicleManager {
    constructor(scene, assets, characterController) {
        this.scene = scene;
        this.assets = assets;
        this.characterController = characterController;
        this.vehicles = [];
        this.currentVehicle = null;
        this.wheels = []; // Store wheels for rotation

        // Vehicle Settings
        this.settings = {
            motorcycle: {
                speed: 20.0,
                turnSpeed: 2.0,
                scale: 0.9,
                // Balanced seat position for the un-folded pose
                seatOffset: new THREE.Vector3(0, 0.288, 0.2)
            }
        };
    }

    spawnVehicle(type, position, rotation) {
        if (!this.assets[type]) {
            console.warn(`Vehicle type ${type} not found in assets.`);
            return;
        }

        const model = this.assets[type].scene.clone();
        model.scale.setScalar(this.settings[type]?.scale || 1.0);
        model.position.copy(position);
        if (rotation) model.rotation.copy(rotation);

        // Shadow support
        const vehicleWheels = [];
        model.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Smart Wheel Detection
                const name = child.name.toLowerCase();
                if (name.includes('wheel') || name.includes('tire') || name.includes('roda')) {
                    vehicleWheels.push(child);
                    console.log("🛞 Wheel Detected:", child.name);
                }
            }
        });

        if (vehicleWheels.length > 0) {
            console.log(`🏍️ Auto-Detected ${vehicleWheels.length} Wheels for Spinning on ${type}.`);
        }

        const vehicle = {
            mesh: model,
            type: type,
            velocity: 0,
            steering: 0,
            wheels: vehicleWheels,
            collider: new THREE.Box3().setFromObject(model),
            raycaster: new THREE.Raycaster() // For collision
        };

        this.scene.add(model);
        this.vehicles.push(vehicle);
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

    enterVehicle(vehicle) {
        if (!vehicle || this.currentVehicle) return;

        this.currentVehicle = vehicle;

        // Notify Character Controller
        this.characterController.setDriving(true, vehicle); // We'll add this method
    }

    exitVehicle() {
        if (!this.currentVehicle) return;

        // Position character slightly to the side
        const exitPos = this.currentVehicle.mesh.position.clone();
        exitPos.x += 1.5;
        // Ensure character is on ground or slightly up
        exitPos.y = Math.max(exitPos.y, 0.1);

        this.characterController.setDriving(false, null, exitPos);
        this.currentVehicle = null;
    }

    update(dt, input) {
        // Vehicle Physics/Movement
        if (this.currentVehicle && this.characterController.isDriving) {
            const v = this.currentVehicle;
            const cfg = this.settings[v.type];

            // Input: input.y (forward/back), input.x (turn)
            // Acceleration
            if (input.y !== 0) {
                v.velocity = THREE.MathUtils.lerp(v.velocity, input.y * cfg.speed, dt * 2);
            } else {
                v.velocity = THREE.MathUtils.lerp(v.velocity, 0, dt * 5); // Friction
            }

            // Continuous Wheel Spin based on velocity
            if (v.wheels && Math.abs(v.velocity) > 0.01) {
                v.wheels.forEach(wheel => {
                    // Rotate on X axis (assuming wheel pivot is centered)
                    // Increased multiplier for faster visual spin
                    wheel.rotateX(v.velocity * dt * 5.0);
                });
            }

            // Turning (only if moving)
            if (Math.abs(v.velocity) > 0.1) {
                const turn = input.x * cfg.turnSpeed * dt * Math.sign(v.velocity); // Reverse steering when backward?
                v.mesh.rotation.y -= turn;
            }

            // 2. GRAVITY & GROUND SNAPPING
            const groundRay = new THREE.Raycaster(
                v.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)),
                new THREE.Vector3(0, -1, 0)
            );
            const groundHits = groundRay.intersectObjects(this.characterController.colliders, true);
            if (groundHits.length > 0) {
                const groundHeight = groundHits[0].point.y;
                // Snap to ground if reasonable distance
                if (Math.abs(v.mesh.position.y - groundHeight) < 5.0) {
                    v.mesh.position.y = groundHeight;
                } else if (v.mesh.position.y > groundHeight) {
                    // Fall down
                    v.mesh.position.y -= 9.8 * dt;
                }
            }

            // 3. COLLISION DETECTION (Horizontal)
            const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(v.mesh.quaternion);
            if (v.velocity < 0) forward.negate(); // Check backward if reversing

            // Raycast origin: Center of vehicle, slightly up
            const rayOrigin = v.mesh.position.clone().add(new THREE.Vector3(0, 0.5, 0));
            v.raycaster.set(rayOrigin, forward);
            v.raycaster.far = 2.0; // Look ahead distance

            // Get colliders from CharacterController (shared world colliders)
            const colliders = this.characterController.colliders || [];
            if (colliders.length > 0) {
                const hits = v.raycaster.intersectObjects(colliders, true);
                if (hits.length > 0) {
                    // Hit something! Stop.
                    v.velocity = 0;
                    // Maybe push back slightly?
                    // v.mesh.position.add(forward.multiplyScalar(-0.1));
                }
            }

            // Move (only if velocity not zero'd by collision)
            v.mesh.translateZ(v.velocity * dt);

            // Sync Character Position/Rotation to Vehicle
            this.characterController.mesh.position.copy(v.mesh.position);
            this.characterController.mesh.rotation.copy(v.mesh.rotation);

            // Apply Seat Offset (rotated)
            const offset = cfg.seatOffset.clone().applyMatrix4(v.mesh.matrixWorld);
            // Actually, seatOffset is local. 
            // Correct way:
            // charPos = vehiclePos + (vehicleRot * seatOffset)
            const localOffset = cfg.seatOffset.clone();
            localOffset.applyQuaternion(v.mesh.quaternion);
            this.characterController.mesh.position.add(localOffset);
        }
    }
}
