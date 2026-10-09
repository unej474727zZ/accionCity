import * as THREE from 'three';

export class SnowEffect {
    constructor(scene, camera, count = 500) {
        this.scene = scene;
        this.camera = camera;
        this.count = count;
        this.range = 80; // Box radius around camera
        this.heightRange = 40;

        // Create round snowflake texture using canvas
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
        grad.addColorStop(0.4, 'rgba(220, 240, 255, 0.7)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 32, 32);

        const tex = new THREE.CanvasTexture(canvas);

        const geometry = new THREE.BufferGeometry();
        this.positions = new Float32Array(count * 3);
        this.velocities = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            this.positions[i * 3 + 0] = (Math.random() - 0.5) * this.range * 2;
            this.positions[i * 3 + 1] = Math.random() * this.heightRange;
            this.positions[i * 3 + 2] = (Math.random() - 0.5) * this.range * 2;

            // Subtle wind drift and fall speed
            this.velocities[i * 3 + 0] = (Math.random() - 0.5) * 1.5;
            this.velocities[i * 3 + 1] = -2.5 - Math.random() * 2.5; // Fall speed
            this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

        const material = new THREE.PointsMaterial({
            size: 1.2,
            map: tex,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.particles = new THREE.Points(geometry, material);
        this.particles.frustumCulled = false;
        this.scene.add(this.particles);
    }

    update(dt) {
        if (!this.particles || !this.camera) return;

        const camPos = this.camera.position;
        const posAttr = this.particles.geometry.attributes.position;
        const pos = posAttr.array;

        for (let i = 0; i < this.count; i++) {
            const idx = i * 3;
            pos[idx + 0] += this.velocities[idx + 0] * dt;
            pos[idx + 1] += this.velocities[idx + 1] * dt;
            pos[idx + 2] += this.velocities[idx + 2] * dt;

            // Recycle flakes when they fall below floor or drift too far from camera
            if (pos[idx + 1] < 0.2 || pos[idx + 1] < camPos.y - 15) {
                pos[idx + 1] = camPos.y + this.heightRange * 0.7;
                pos[idx + 0] = camPos.x + (Math.random() - 0.5) * this.range * 1.6;
                pos[idx + 2] = camPos.z + (Math.random() - 0.5) * this.range * 1.6;
            }

            // Keep snow centered around camera horizontally
            if (Math.abs(pos[idx + 0] - camPos.x) > this.range) {
                pos[idx + 0] = camPos.x + (Math.random() - 0.5) * this.range;
            }
            if (Math.abs(pos[idx + 2] - camPos.z) > this.range) {
                pos[idx + 2] = camPos.z + (Math.random() - 0.5) * this.range;
            }
        }

        posAttr.needsUpdate = true;
    }
}
