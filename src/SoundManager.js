import * as THREE from 'three';

export class SoundManager {
    constructor(camera) {
        this.camera = camera;
        this.listener = new THREE.AudioListener();

        if (this.camera) {
            this.camera.add(this.listener);
        }

        this.audioLoader = new THREE.AudioLoader();

        this.sounds = {
            pistol: null,
            rifle: null
        };

        // Audio Pools to prevent improved garbage collection issues and mobile limits
        this.pools = {
            pistol: [],
            rifle: []
        };
        this.poolSize = 5;
        this.poolIndex = { pistol: 0, rifle: 0 };

        this.loadSounds();
    }

    loadSounds() {
        // Load Pistol
        this.audioLoader.load('/sounds/pistolaSoundUno.mp3', (buffer) => {
            this.sounds.pistol = buffer;
            this.createPool('pistol', buffer);
            console.log("SoundManager: Pistol sound loaded + Pool created.");
        });

        // Load Rifle
        this.audioLoader.load('/sounds/rifleSoundUno.mp3', (buffer) => {
            this.sounds.rifle = buffer;
            this.createPool('rifle', buffer, 0.3);
            console.log("SoundManager: Rifle sound loaded.");
        });

        // TANK: Shots and Crush
        this.audioLoader.load('/sounds/tank-shots.mp3', (buffer) => {
            this.sounds['tank-shot'] = buffer;
            this.createPool('tank-shot', buffer, 2, 3);
        });
        this.audioLoader.load('/sounds/tank-crush.mp3', (buffer) => {
            this.sounds['tank-crush'] = buffer;
            this.createPool('tank-crush', buffer, 0.6, 3);
        });
    }

    createPool(type, buffer, volume = 0.4, size = 5) {
        if (!this.pools[type]) this.pools[type] = [];
        for (let i = 0; i < size; i++) {
            const sound = new THREE.Audio(this.listener);
            sound.setBuffer(buffer);
            sound.setVolume(volume);
            this.pools[type].push(sound);
        }
        this.poolIndex[type] = 0;
    }

    playShoot(type) {
        this.playPool(type, 1.0 + (Math.random() * 0.1 - 0.05));
    }

    playTankShot() {
        this.playPool('tank-shot', 1.0);
    }

    playTankCrush() {
        this.playPool('tank-crush', 1.0 + (Math.random() * 0.2 - 0.1));
    }

    playPool(type, pitch = 1.0) {
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }

        if (!this.pools[type] || this.pools[type].length === 0) return;

        const index = this.poolIndex[type];
        const sound = this.pools[type][index];

        if (sound.isPlaying) sound.stop();
        sound.setPlaybackRate(pitch);
        sound.play();

        this.poolIndex[type] = (index + 1) % this.pools[type].length;
    }

    // LEGACY / UTILITY
    playExplosion(pos) {
        this.playTankShot();
    }
}
