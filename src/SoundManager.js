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
            this.createPool('rifle', buffer);
            console.log("SoundManager: Rifle sound loaded + Pool created.");
        });
    }

    createPool(type, buffer) {
        for (let i = 0; i < this.poolSize; i++) {
            const sound = new THREE.Audio(this.listener);
            sound.setBuffer(buffer);
            sound.setVolume(type === 'rifle' ? 0.3 : 0.4);
            this.pools[type].push(sound);
        }
    }

    playShoot(type) {
        // Ensure AudioContext is running (Mobile requirement)
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }

        if (!this.pools[type] || this.pools[type].length === 0) {
            // Fallback if not loaded yet
            // console.warn(`SoundManager: Pool for ${type} not ready.`);
            return;
        }

        // Cycle through pool
        const index = this.poolIndex[type];
        const sound = this.pools[type][index];

        // Stop if currently playing to restart (rapid fire)
        if (sound.isPlaying) sound.stop();

        // Randomize pitch slightly for realism
        const detune = 1.0 + (Math.random() * 0.1 - 0.05);
        sound.setPlaybackRate(detune);

        sound.play();

        // Advance index
        this.poolIndex[type] = (index + 1) % this.poolSize;
    }
}
