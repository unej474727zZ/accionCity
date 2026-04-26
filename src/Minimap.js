import * as THREE from 'three';

export class Minimap {
    constructor(cityBlocks, camera) {
        this.cityBlocks = cityBlocks || [];
        this.camera = camera;
        this.minimapCamera = null;
        
        const existing = document.getElementById('minimap-canvas');
        if (existing) existing.remove();

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'minimap-canvas';
        this.canvas.width = 200;
        this.canvas.height = 200;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '10px';
        this.canvas.style.right = '10px';
        this.canvas.style.border = '2px solid rgba(0, 255, 255, 0.8)'; 
        this.canvas.style.borderRadius = '10px';
        this.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; 
        this.canvas.style.zIndex = '100000'; 
        this.canvas.style.pointerEvents = 'none'; 
        document.body.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        this.isFullMap = false; 
        this.originalSize = 200;
        this._tempVec = new THREE.Vector3();
    }

    toggleUI() {
        this.isFullMap = !this.isFullMap;
        
        if (this.isFullMap) {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
            this.canvas.style.top = '0';
            this.canvas.style.left = '0';
            this.canvas.style.border = 'none';
            this.canvas.style.borderRadius = '0';
            this.canvas.style.pointerEvents = 'auto'; 
        } else {
            this.canvas.width = this.originalSize;
            this.canvas.height = this.originalSize;
            this.canvas.style.top = '10px';
            this.canvas.style.right = '10px';
            this.canvas.style.left = 'auto';
            this.canvas.style.border = '2px solid rgba(0, 255, 255, 0.8)';
            this.canvas.style.borderRadius = '10px';
            this.canvas.style.pointerEvents = 'none';
        }
        
        this.ctx = this.canvas.getContext('2d');
        this.canvas.style.display = 'block'; 
    }

    projectToCanvas(worldPos, viewCamera) {
        viewCamera.updateMatrixWorld();
        this._tempVec.copy(worldPos);
        this._tempVec.project(viewCamera);

        return {
            x: (this._tempVec.x * 0.5 + 0.5) * this.canvas.width,
            y: (this._tempVec.y * -0.5 + 0.5) * this.canvas.height,
            z: this._tempVec.z
        };
    }

    update(character, remotePlayers, npcManager, vehicleManager, activeCamera) {
        if (!character || !character.mesh || !this.ctx || !activeCamera) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        // 1. NPCs (Cian para autos, Rojo para tanques)
        if (npcManager && npcManager.cars) {
            npcManager.cars.forEach(car => {
                const pos = this.projectToCanvas(car.position, activeCamera);
                if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                    if (vehicleManager && vehicleManager.isArmor(car)) {
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.7)'; // Tank NPC = Rojo semi-transparente
                        ctx.fillRect(pos.x - 2, pos.y - 2, 4, 4);
                    } else {
                        ctx.fillStyle = 'rgba(0, 255, 255, 0.7)'; // Auto normal = Cian semi-transparente
                        ctx.fillRect(pos.x - 1, pos.y - 1, 2, 2);
                    }
                }
            });
        }

        // 2. JUGADORES REMOTOS (Amarillo)
        Object.values(remotePlayers).forEach(p => {
            if (p.mesh) {
                const pos = this.projectToCanvas(p.mesh.position, activeCamera);
                if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                    ctx.fillStyle = '#ffff00';
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        });

        // 3. VEHÍCULOS (Tanque/Moto)
        if (vehicleManager && vehicleManager.vehicles) {
            vehicleManager.vehicles.forEach(v => {
                const pos = this.projectToCanvas(v.mesh.position, activeCamera);
                if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                    if (v.type === 'motorcycle') {
                        ctx.fillStyle = 'rgba(255, 153, 0, 0.7)'; 
                        ctx.fillRect(pos.x - 3, pos.y - 3, 6, 6);
                    } else if (v.type === 'tank') {
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)'; 
                        ctx.fillRect(pos.x - 4, pos.y - 4, 8, 8);
                    } else if (v.type === 'helicopter') {
                        ctx.fillStyle = 'rgba(204, 153, 255, 0.8)'; // Lila para helicópteros
                        ctx.fillRect(pos.x - 4, pos.y - 4, 8, 8);
                    }
                }
            });
        }

        // 4. JUGADOR LOCAL (Flecha Blanca)
        const playerMesh = character.mesh;
        const footPos = this.projectToCanvas(playerMesh.position, activeCamera);
        if (footPos.z < 1.0) {
            ctx.save();
            ctx.translate(footPos.x, footPos.y);
            // Usamos character.yaw en lugar de rotation local del mesh, 
            // ya que al subir a un vehículo el mesh hereda rotación local 0
            // Sumar Math.PI / 2 o ajustar según necesidad. El yaw es ángulo en eje Y.
            // En Three.js default cámara mira a -Z. Minimap "norte" es -Z. 
            // character.yaw = 0 significa mirar a -Z.
            // Para que apunte arriba (0 rad) cuando yaw es 0:
            ctx.rotate(-character.yaw); 
            
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(0, -10);
            ctx.lineTo(8, 8);
            ctx.lineTo(0, 3);
            ctx.lineTo(-8, 8);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
    }
}


