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
        // Removed redundant updateMatrixWorld() - now called once per frame in update()
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

        // CRITICAL PERFORMANCE: Update camera matrices ONCE per frame
        activeCamera.updateMatrixWorld();
        
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
                    ctx.save();
                    ctx.translate(pos.x, pos.y);
                    // Rotar el canvas para que coincida con la orientación del vehículo
                    ctx.rotate(-v.mesh.rotation.y - Math.PI / 2);

                    if (v.type === 'motorcycle') {
                        ctx.fillStyle = 'rgba(255, 153, 0, 0.9)'; 
                        // Dibujar un rectángulo alargado (moto)
                        ctx.fillRect(-2, -4, 4, 8);
                    } else if (v.type === 'tank') {
                        ctx.fillStyle = 'rgba(255, 0, 0, 0.9)'; 
                        // Dibujar un chasis de tanque
                        ctx.fillRect(-4, -5, 8, 10);
                        // Dibujar el cañón (frente)
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(-1, -8, 2, 4);
                    } else if (v.type === 'helicopter') {
                        ctx.fillStyle = 'rgba(204, 153, 255, 0.9)';
                        // Dibujar forma de helicóptero (cruz)
                        ctx.fillRect(-4, -2, 8, 4);
                        ctx.fillRect(-1, -6, 2, 12);
                    }
                    ctx.restore();
                }
            });
        }

        // 5. JUGADOR LOCAL (Flecha Blanca)
        const playerMesh = character.mesh;
        const worldPos = new THREE.Vector3();
        playerMesh.getWorldPosition(worldPos); // Extraer posición real global
        
        const footPos = this.projectToCanvas(worldPos, activeCamera);
        if (footPos.z < 1.0) {
            ctx.save();
            ctx.translate(footPos.x, footPos.y);
            
            // Si está conduciendo un tanque/heli, ocultamos la flecha blanca
            // (porque el icono del vehículo ya muestra dónde estamos)
            // Si es moto, sí la mostramos para saber hacia dónde miramos.
            const hidePlayerIcon = character.isDriving && character.vehicle && character.vehicle.type !== 'motorcycle';
            
            if (!hidePlayerIcon) {
                let displayYaw = character.yaw;
                ctx.rotate(-displayYaw + Math.PI); 
                
                ctx.fillStyle = character.isDriving ? '#00ffff' : '#ffffff'; // Cian si conduce moto
                ctx.beginPath();
                ctx.moveTo(0, -10);
                ctx.lineTo(8, 8);
                ctx.lineTo(0, 3);
                ctx.lineTo(-8, 8);
                ctx.closePath();
                ctx.fill();
            }
            ctx.restore();
        }
    }
}


