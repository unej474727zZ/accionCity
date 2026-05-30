import * as THREE from 'three';
import { Bot } from './Bot.js';

export class BotManager {
    constructor(scene, assets, world) {
        this.scene = scene;
        this.assets = assets;
        this.world = world;
        this.bots = [];
        this.maxBots = 12; // Increased from 5 to populate city more
        this.spawnRadius = 80; // Max distance to spawn
        this.minSpawnRadius = 40; // Min distance to spawn
        this.despawnRadius = 200; // Distance to remove bot
        
        this.aiTickTimer = 0;
        this.aiTickRate = 0.2; // 5 Hz

        this.botCounter = 0;
    }

    update(dt) {
        // 1. Tick AI periodically (Optimization)
        this.aiTickTimer += dt;
        if (this.aiTickTimer >= this.aiTickRate) {
            this.aiTickTimer = 0;
            this.tickAI();
            this.checkPopulation();
        }

        // 2. Update visual and physics per frame
        for (let bot of this.bots) {
            bot.update(dt);
        }
    }

    tickAI() {
        for (let bot of this.bots) {
            bot.updateAI();
        }
    }

    checkPopulation() {
        if (!this.world.character || !this.world.character.mesh) return;

        const playerPos = this.world.character.mesh.position;

        // Despawn far away bots
        for (let i = this.bots.length - 1; i >= 0; i--) {
            const bot = this.bots[i];
            if (bot.state === 'dead') continue;

            const dist = bot.mesh.position.distanceTo(playerPos);
            if (dist > this.despawnRadius) {
                bot.dispose();
                this.bots.splice(i, 1);
            }
        }

        // Spawn new bots if below max
        const activeBots = this.bots.filter(b => b.state !== 'dead').length;
        if (activeBots < this.maxBots) {
            this.spawnBot(playerPos);
        }
    }

    spawnBot(playerPos) {
        this.botCounter++;
        const angle = Math.random() * Math.PI * 2;
        const dist = this.minSpawnRadius + Math.random() * (this.spawnRadius - this.minSpawnRadius);
        
        const spawnX = playerPos.x + Math.cos(angle) * dist;
        const spawnZ = playerPos.z + Math.sin(angle) * dist;
        const spawnPos = new THREE.Vector3(spawnX, 0.5, spawnZ);

        const bot = new Bot(this.scene, this.assets, `bot_${this.botCounter}`, spawnPos, this.world, this);
        this.bots.push(bot);
        console.log(`BotManager: Spawned Bot ${this.botCounter} at ${spawnX.toFixed(0)}, ${spawnZ.toFixed(0)}`);
    }

    removeBot(id) {
        const index = this.bots.findIndex(b => b.id === id);
        if (index !== -1) {
            this.bots[index].dispose();
            this.bots.splice(index, 1);
        }
    }
}
