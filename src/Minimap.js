export class Minimap {
    constructor() {
        // Create Canvas Overlay
        this.canvas = document.createElement('canvas');
        this.canvas.width = 200;
        this.canvas.height = 200;
        this.canvas.style.position = 'absolute';
        this.canvas.style.top = '10px';
        this.canvas.style.right = '10px';
        this.canvas.style.border = '2px solid rgba(0, 255, 0, 0.5)';
        this.canvas.style.borderRadius = '10px';
        this.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'; // Semi-transparent black
        this.canvas.style.zIndex = '1000';
        this.canvas.id = 'minimap-canvas'; // Added ID for toggling
        document.body.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Map Settings
        this.mapScale = 0.2; // Zoom level (Pixels per World Unit)
        // Adjust scale based on city size (approx 800x800) -> 200px / 800 = 0.25
    }

    toggleUI(visible) {
        this.canvas.style.display = visible ? 'block' : 'none';
    }

    update(playerMesh, remotePlayers, npcManager) {
        if (!playerMesh) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const center = width / 2;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // --- DRAW LOGIC ---
        // We want the player to be ALWAYS IN THE CENTER
        // So we shift the world around the player.

        const px = playerMesh.position.x;
        const pz = playerMesh.position.z;
        const pyaw = playerMesh.rotation.y; // Or character.yaw

        // Helper to map world pos to canvas pos (relative to player)
        const toMap = (wx, wz) => {
            // Difference from player
            const dx = wx - px;
            const dz = wz - pz;

            // Rotate by player yaw? Usually minimaps are "North Up" or "Player Up".
            // Let's do "Player Up" (Rotating map) for shooter feel, or "North Up" (Static map).
            // User asked for "Aerial View", usually implies North Up.
            // Let's stick to simple "North Up" first (easier to read).

            // Just Scale and Offset to center
            return {
                x: center + (dx * this.mapScale),
                y: center + (dz * this.mapScale)
            };
        };

        // 1. Draw Cars (Blue Boxes)
        if (npcManager && npcManager.cars) {
            ctx.fillStyle = '#6666cc'; // Blue-ish
            npcManager.cars.forEach(car => {
                const pos = toMap(car.position.x, car.position.z);
                // Draw 6x4 px box (approx car shape)
                // Check bounds roughly
                if (pos.x > -10 && pos.x < width + 10 && pos.y > -10 && pos.y < height + 10) {
                    ctx.save();
                    ctx.translate(pos.x, pos.y);
                    ctx.rotate(-car.rotation.y); // Rotate box to match car
                    ctx.fillRect(-3, -2, 6, 4); // Center at 0,0
                    ctx.restore();
                }
            });
        }

        // 2. Draw Remote Players (Yellow Dots with border)
        Object.values(remotePlayers).forEach(p => {
            if (p.mesh) {
                const pos = toMap(p.mesh.position.x, p.mesh.position.z);
                // Check bounds (clip if outside map)
                if (pos.x >= 0 && pos.x <= width && pos.y >= 0 && pos.y <= height) {
                    ctx.fillStyle = '#ffcc00'; // Bright Yellow
                    ctx.beginPath();
                    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2); // Larger (5px)
                    ctx.fill();

                    // Stroke for contrast
                    ctx.strokeStyle = 'black';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            }
        });

        // 3. Draw Local Player (Green Arrow/Dot in Center)
        ctx.fillStyle = '#00ff00';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;

        // Draw Arrow indicating facing direction
        // Since Map is North Up, player arrow rotates.
        ctx.save();
        ctx.translate(center, center);
        // Player Mesh rotation.y is usually model rotation. CharacterController handles yaw.
        // If we want Arrow to point where player looks, we need Yaw.

        // ThreeJS rotation is typically 0 = facing +Z? or -Z?
        // Need to test. Usually player.rotation.y works.
        ctx.rotate(-playerMesh.rotation.y + Math.PI); // Invert for canvas 2D rotation

        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(5, 5);
        ctx.lineTo(0, 2);
        ctx.lineTo(-5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
}
