import * as THREE from 'three';

export class Minimap {
    constructor(cityBlocks, camera) {
        this.cityBlocks = cityBlocks || [];
        this.camera = camera;
        this.minimapCamera = null;
        
        const existing = document.getElementById('minimap-canvas');
        if (existing) existing.remove();

        this.originalSize = window.innerWidth <= 800 ? 100 : 150;
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'minimap-canvas';
        this.canvas.width = this.originalSize;
        this.canvas.height = this.originalSize;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '10px';
        this.canvas.style.right = '10px';
        this.canvas.style.border = 'none'; 
        this.canvas.style.borderRadius = '10px';
        this.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; 
        this.canvas.style.zIndex = '100000'; 
        this.canvas.style.pointerEvents = 'none'; 
        this.canvas.style.opacity = '0.7';
        document.body.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        this.isFullMap = false; 
        this._tempVec = new THREE.Vector3();
        this._worldPos = new THREE.Vector3();
        this.targetWaypoint = null;
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
            this.canvas.style.border = 'none';
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

    update(character, remotePlayers, npcManager, vehicleManager, activeCamera, botManager) {
        if (!character || !character.mesh || !this.ctx || !activeCamera) return;

        // CRITICAL PERFORMANCE: Update camera matrices ONCE per frame
        activeCamera.updateMatrixWorld();
        
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.clearRect(0, 0, width, height);

        // 1. NPCs (Autos civiles)
        if (npcManager && npcManager.cars) {
            npcManager.cars.forEach(car => {
                const pos = this.projectToCanvas(car.position, activeCamera);
                if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                    ctx.fillStyle = 'rgba(0, 255, 255, 0.7)'; // Auto normal = Cian semi-transparente
                    ctx.fillRect(pos.x - 1, pos.y - 1, 2, 2);
                }
            });
        }

        // 1.5. PURSUING NPCS (Bright Red Threat Radar)
        if (botManager && botManager.bots) {
            botManager.bots.forEach(bot => {
                if (bot.state !== 'dead' && bot.mesh) {
                    const pos = this.projectToCanvas(bot.mesh.position, activeCamera);
                    if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                        ctx.fillStyle = '#ff0033';
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
                        ctx.fill();

                        // Threat pulsing ring
                        ctx.strokeStyle = '#ff0033';
                        ctx.lineWidth = 1.0;
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
                        ctx.stroke();
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

        // 4. MISSILES / SHELLS (Threat Radar)
        if (window.weaponManager && window.weaponManager.tankShells) {
            const v = character.vehicle;
            const vPos = v ? v.mesh.position : this._worldPos;

            window.weaponManager.tankShells.forEach(shell => {
                if (!shell.mesh) return;
                const dist = shell.mesh.position.distanceTo(vPos);
                
                // Only show projectiles within 500m on map
                if (dist < 500) {
                    const pos = this.projectToCanvas(shell.mesh.position, activeCamera);
                    if (pos.z < 1.0 && pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                        // Trajectory check
                        const toMe = vPos.clone().sub(shell.mesh.position).normalize();
                        const forward = shell.direction || new THREE.Vector3(0,0,1).applyQuaternion(shell.mesh.quaternion);
                        const dot = forward.dot(toMe);
                        const isThreat = (dot > 0.8 || (v && shell.targetVehicle === v));

                        ctx.fillStyle = isThreat ? '#ff0000' : '#ffff00';
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, isThreat ? 4 : 2, 0, Math.PI * 2);
                        ctx.fill();

                        if (isThreat) {
                            // Direction vector on map
                            const screenDir = this.projectToCanvas(shell.mesh.position.clone().add(forward.clone().multiplyScalar(10)), activeCamera);
                            ctx.strokeStyle = '#ff0000';
                            ctx.lineWidth = 2;
                            ctx.beginPath();
                            ctx.moveTo(pos.x, pos.y);
                            ctx.lineTo(screenDir.x, screenDir.y);
                            ctx.stroke();
                        }
                    }
                }
            });
        }

        // 5. JUGADOR LOCAL (Flecha Blanca)
        const playerMesh = character.mesh;
        playerMesh.getWorldPosition(this._worldPos); 
        
        const footPos = this.projectToCanvas(this._worldPos, activeCamera);
        if (footPos.z < 1.0) {
            ctx.save();
            ctx.translate(footPos.x, footPos.y);
            
            const hidePlayerIcon = character.isDriving && character.vehicle && character.vehicle.type !== 'motorcycle';
            
            if (!hidePlayerIcon) {
                let displayYaw = character.yaw;
                ctx.rotate(-displayYaw + Math.PI); 
                
                ctx.fillStyle = character.isDriving ? '#00ffff' : '#ffffff'; 
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

        // 6. RADAR NAVIGATION BEACON (Sector Cero Air Access Waypoint)
        if (this.targetWaypoint) {
            const charPos = (character.isDriving && character.vehicle) ? character.vehicle.mesh.position : this._worldPos;
            const dist = Math.round(charPos.distanceTo(this.targetWaypoint));

            const wpScreen = this.projectToCanvas(this.targetWaypoint, activeCamera);
            const isVisibleOnRadar = (wpScreen.z < 1.0 && wpScreen.x >= 12 && wpScreen.x <= width - 12 && wpScreen.y >= 12 && wpScreen.y <= height - 12);

            const time = performance.now() * 0.005;
            const pulse = (Math.sin(time) + 1.0) * 0.5;

            if (isVisibleOnRadar) {
                // Pulsing Green Helipad Radar Target
                ctx.strokeStyle = '#00ffaa';
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.arc(wpScreen.x, wpScreen.y, 6 + pulse * 5, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = '#00ffaa';
                ctx.beginPath();
                ctx.arc(wpScreen.x, wpScreen.y, 3, 0, Math.PI * 2);
                ctx.fill();

                // 'H' icon
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('H', wpScreen.x, wpScreen.y - 10);
            } else {
                // Directional Pointer clamped to radar border
                const dx = this.targetWaypoint.x - charPos.x;
                const dz = this.targetWaypoint.z - charPos.z;
                const worldAngle = Math.atan2(dx, dz);
                const charAngle = (character.isDriving && character.vehicle) ? character.vehicle.mesh.rotation.y : character.yaw;
                const relAngle = worldAngle - charAngle;

                const cx = width / 2;
                const cy = height / 2;
                const radius = Math.min(width, height) * 0.42;
                const px = cx + Math.sin(relAngle) * radius;
                const py = cy - Math.cos(relAngle) * radius;

                ctx.save();
                ctx.translate(px, py);
                ctx.rotate(relAngle);
                ctx.fillStyle = '#00ffaa';
                ctx.beginPath();
                ctx.moveTo(0, -7);
                ctx.lineTo(5, 5);
                ctx.lineTo(-5, 5);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
            }

            // Bottom distance HUD readout
            ctx.fillStyle = 'rgba(10, 20, 25, 0.85)';
            ctx.fillRect(4, height - 16, width - 8, 14);
            ctx.strokeStyle = 'rgba(0, 255, 170, 0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(4, height - 16, width - 8, 14);

            ctx.fillStyle = '#00ffaa';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`🚁 SECTOR 0: ${dist}m`, width / 2, height - 9);
        }
    }
}


