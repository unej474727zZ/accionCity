import * as THREE from 'three';
import { Bot } from './Bot.js';

// Static scratch vectors to prevent GC pauses
const _playerPos = new THREE.Vector3();
const _spawnPos = new THREE.Vector3();

export class BotManager {
    constructor(scene, assets, world) {
        this.scene = scene;
        this.assets = assets;
        this.world = world;
        this.bots = [];
        this.maxBots = 2; // EXACTLY 2 pursuers at all times (reduced from 3 for mobile performance)
        this.minSpawnRadius = 35;
        this.maxSpawnRadius = 50;
        this.despawnRadius = 140; // Max distance before teleporting closer to protagonist

        this.aiTickTimer = 0;
        this.aiTickRate = 0.15; // ~6.6 Hz AI evaluations

        this.initialized = false;
    }

    getPlayerPos(outVec) {
        if (!this.world.character || !this.world.character.mesh) return false;
        if (this.world.characterController && this.world.characterController.isDriving && this.world.characterController.vehicle) {
            outVec.copy(this.world.characterController.vehicle.mesh.position);
        } else {
            this.world.character.mesh.getWorldPosition(outVec);
        }
        return true;
    }

    getRandomSpawnPos(outVec) {
        let attempts = 0;
        let valid = false;
        const centerZ = (this.world && this.world.modularCity && this.world.modularCity.center) ? this.world.modularCity.center.z : 240;
        while (!valid && attempts < 100) {
            attempts++;
            const rx = (Math.random() - 0.5) * 110;
            const rz = centerZ + (Math.random() - 0.5) * 110;
            
            // Check distance to other bots
            valid = true;
            for (let bot of this.bots) {
                if (!bot.mesh) continue;
                const dx = bot.mesh.position.x - rx;
                const dz = bot.mesh.position.z - rz;
                if (Math.sqrt(dx*dx + dz*dz) < 20) {
                    valid = false;
                    break;
                }
            }
            
            // Check if inside building
            if (valid && this.world && this.world.cityBlocks) {
                for (const block of this.world.cityBlocks) {
                    if ((block.maxX - block.minX) > 1000 || (block.maxZ - block.minZ) > 1000) continue;
                    
                    if (rx > block.minX - 4 && rx < block.maxX + 4 && rz > block.minZ - 4 && rz < block.maxZ + 4) {
                        valid = false;
                        break;
                    }
                }
            }

            if (valid) {
                outVec.set(rx, 0.5, rz); // Street level
                return;
            }
        }
        // Fallback inside Sector Cero
        outVec.set(0, 0.5, centerZ + 20);
    }

    initBots() {
        if (this.initialized) return;

        // Spawn 3 pursuers completely random on the map
        for (let i = 0; i < this.maxBots; i++) {
            this.getRandomSpawnPos(_spawnPos);
            const bot = new Bot(this.scene, this.assets, `pursuer_${i + 1}`, _spawnPos, this.world, this, i);
            this.bots.push(bot);
        }

        this.initialized = true;
        console.log(`BotManager: Initialized 2-NPC random spawn squad.`);
    }

    update(dt) {
        if (!this.initialized) {
            this.initBots();
            return;
        }

        // 1. Update Dead Respawn Timers
        for (let bot of this.bots) {
            if (bot.state === 'dead') {
                bot.respawnTimer -= dt;
                if (bot.respawnTimer <= 0) {
                    this.recycleBot(bot);
                }
            }
        }

        // 2. Tick AI & Tether Checks
        this.aiTickTimer += dt;
        if (this.aiTickTimer >= this.aiTickRate) {
            this.aiTickTimer = 0;
            this.tickAI();
            // Tether check completely disabled as per user request!
        }

        // 3. Update Visuals and Physics
        for (let bot of this.bots) {
            bot.update(dt);
        }
    }

    tickAI() {
        for (let bot of this.bots) {
            bot.updateAI();
        }
    }

    checkTether() {
        // Disabled tethering! NPCs now stay where they are or wander.
    }

    onBotKilled(bot) {
        // Respawns after 3 seconds
        bot.respawnTimer = 3.0;
        console.log(`BotManager: Pursuer ${bot.id} defeated. Respawn in 3 seconds.`);
    }

    recycleBot(bot) {
        this.getRandomSpawnPos(_spawnPos);
        bot.respawn(_spawnPos);
        console.log(`BotManager: Pursuer ${bot.id} respawned in random map location!`);
    }

    removeBot(id) {
        // In this architecture, bots are never disposed/deleted from the pool
    }
}
