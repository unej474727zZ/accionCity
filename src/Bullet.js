
import * as THREE from 'three';

export class Bullet {
    constructor(scene, position, direction, speed) {
        this.scene = scene;
        this.speed = speed;
        this.direction = direction.normalize();

        // Visuals
        // Long glowing cylinder - TRAIL EFFECT
        const geom = new THREE.CylinderGeometry(0.1, 0.1, 3.0, 8); // Thicker (0.1), Longer (3.0)
        geom.rotateX(Math.PI / 2); // Align with Z
        const mat = new THREE.MeshBasicMaterial({ color: 0xffaa00 }); // Orange/Gold
        this.mesh = new THREE.Mesh(geom, mat);

        this.mesh.position.copy(position);
        this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.direction);

        // Add Light to Bullet? NO. Causes lag.
        // const light = new THREE.PointLight(0xffaa00, 2, 10);
        // this.mesh.add(light);

        this.mesh.userData.type = 'bullet';
        this.scene.add(this.mesh);

        this.active = true;
        this.lifetime = 5.0; // Seconds
    }

    update(dt) {
        if (!this.active) return;

        // Move
        const moveDist = this.speed * dt;
        this.mesh.position.add(this.direction.clone().multiplyScalar(moveDist));

        // Lifetime
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.destroy();
        }
    }

    destroy() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
        this.active = false;
    }
}
