import * as THREE from 'three';

export class NPCManager {
    constructor(scene, assets) {
        this.scene = scene;
        this.assets = assets;
        this.cars = [];
        // Sector Cero City bounds
        this.bounds = { minX: -55, maxX: 55, minZ: 185, maxZ: 295 };
    }

    initParkedCars(count = 8) {
        // Exclude heavy 3.6MB tank from civilian parked cars
        const carKeys = ['car1', 'casco', 'car3'];
        const availableCars = carKeys.filter(k => this.assets[k]);

        if (availableCars.length === 0) return;

        let spawned = 0;
        const totalToSpawn = Math.min(count, 10);

        for (let i = 0; i < totalToSpawn; i++) {
            const x = THREE.MathUtils.randFloat(this.bounds.minX, this.bounds.maxX);
            const z = THREE.MathUtils.randFloat(this.bounds.minZ, this.bounds.maxZ);

            this.spawnCar(x, z, availableCars);
            spawned++;
        }
        console.log(`NPCManager: Spawned ${spawned} optimized parked cars (Shared materials).`);
    }

    spawnCar(x, z, availableCars) {
        const key = availableCars[Math.floor(Math.random() * availableCars.length)];
        const original = this.assets[key].scene;
        const car = original.clone();

        // Optimized: Enable shadows without cloning materials to save VRAM and drawcalls
        car.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        car.position.set(x, 0.5, z);
        const scale = 0.6;
        car.scale.set(scale, scale, scale);
        car.rotation.y = Math.random() * Math.PI * 2;

        this.scene.add(car);
        this.cars.push(car);
    }

    setColliders(colliders) { }
    update(dt) { }
}
