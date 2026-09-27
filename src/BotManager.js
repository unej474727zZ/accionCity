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
        this.maxBots = 3; // EXACTLY 3 pursuers at all times
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

    initBots() {
        if (this.initialized) return;
        if (!this.getPlayerPos(_playerPos)) return;

        // Spawn 3 pursuers in triangular formation around protagonist
        const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        for (let i = 0; i < this.maxBots; i++) {
            const angle = angles[i];
            const dist = 35 + i * 5;
            _spawnPos.set(
                _playerPos.x + Math.cos(angle) * dist,
                0.5,
                _playerPos.z + Math.sin(angle) * dist
            );

            const bot = new Bot(this.scene, this.assets, `pursuer_${i + 1}`, _spawnPos, this.world, this, i);
            this.bots.push(bot);
        }

        this.initialized = true;
        console.log(`BotManager: Initialized 3-NPC relentless pursuit squad.`);
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
            this.checkTether();
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
        if (!this.getPlayerPos(_playerPos)) return;

        // If protagonist drove away and distance > despawnRadius, reposition bot ahead
        for (let bot of this.bots) {
            if (bot.state === 'dead' || !bot.mesh) continue;

            const dist = bot.mesh.position.distanceTo(_playerPos);
            if (dist > this.despawnRadius) {
                // Re-tether closer so the protagonist is ALWAYS pursued
                const angle = Math.random() * Math.PI * 2;
                const spawnDist = 40.0;
                _spawnPos.set(
                    _playerPos.x + Math.cos(angle) * spawnDist,
                    0.5,
                    _playerPos.z + Math.sin(angle) * spawnDist
                );
                bot.respawn(_spawnPos);
                console.log(`BotManager: Re-tethered Pursuer ${bot.id} at ${spawnDist}m`);
            }
        }
    }

    onBotKilled(bot) {
        // Respawns after 3 seconds
        bot.respawnTimer = 3.0;
        console.log(`BotManager: Pursuer ${bot.id} defeated. Respawn in 3 seconds.`);
    }

    recycleBot(bot) {
        if (!this.getPlayerPos(_playerPos)) return;

        // Respawn at flanking distance (35-45m)
        const angle = Math.random() * Math.PI * 2;
        const dist = 35 + Math.random() * 10;
        _spawnPos.set(
            _playerPos.x + Math.cos(angle) * dist,
            0.5,
            _playerPos.z + Math.sin(angle) * dist
        );

        bot.respawn(_spawnPos);
        console.log(`BotManager: Pursuer ${bot.id} respawned and resumed pursuit!`);
    }

    removeBot(id) {
        // In this architecture, bots are never disposed/deleted from the pool
    }
}
