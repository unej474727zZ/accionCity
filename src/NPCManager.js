import * as THREE from 'three';

export class NPCManager {
    constructor(scene, assets) {
        this.scene = scene;
        this.assets = assets;
        this.cars = [];
        // City bounds
        this.bounds = { minX: -400, maxX: 400, minZ: -400, maxZ: 400 };
    }

    initParkedCars(count) {
        const carKeys = ['car1', 'car2', 'car3', 'tank'];
        const availableCars = carKeys.filter(k => this.assets[k]);

        if (availableCars.length === 0) return;

        let spawned = 0;

        // FORCE SPAWN: Simple Random Placement
        // No Raycasts. Just math.
        for (let i = 0; i < count; i++) {
            const x = THREE.MathUtils.randFloat(this.bounds.minX, this.bounds.maxX);
            const z = THREE.MathUtils.randFloat(this.bounds.minZ, this.bounds.maxZ);

            this.spawnCar(x, z, availableCars);
            spawned++;
        }
        console.log(`NPCManager: Force Spawned ${spawned} cars.`);
    }

    spawnCar(x, z, availableCars) {
        const key = availableCars[Math.floor(Math.random() * availableCars.length)];
        const original = this.assets[key].scene;
        const car = original.clone();

        car.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                if (child.material) {
                    child.material = child.material.clone();
                    child.material.color.setHSL(Math.random(), 0.5, 0.5);
                }
            }
        });

        car.position.set(x, 0.5, z);
        
        // Scale adjustment per model
        const scale = (key === 'tank') ? 1.2 : 0.6;
        car.scale.set(scale, scale, scale);
        
        car.rotation.y = Math.random() * Math.PI * 2;

        this.scene.add(car);
        this.cars.push(car);
    }

    setColliders(colliders) { }
    update(dt) { }
}
