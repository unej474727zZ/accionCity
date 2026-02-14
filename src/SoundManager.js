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

        this.loadSounds();
    }

    loadSounds() {
        // Load Pistol
        this.audioLoader.load('/sounds/pistolaSoundUno.mp3', (buffer) => {
            this.sounds.pistol = buffer;
            console.log("SoundManager: Pistol sound loaded.");
        });

        // Load Rifle
        this.audioLoader.load('/sounds/rifleSoundUno.mp3', (buffer) => {
            this.sounds.rifle = buffer;
            console.log("SoundManager: Rifle sound loaded.");
        });
    }

    playShoot(type) {
        // Ensure AudioContext is running
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }

        let buffer = null;
        let volume = 0.5;

        if (type === 'pistol') {
            buffer = this.sounds.pistol;
            volume = 0.4;
        } else if (type === 'rifle') {
            buffer = this.sounds.rifle;
            volume = 0.3; // Rifle sound might be louder naturally
        }

        if (buffer) {
            const sound = new THREE.Audio(this.listener);
            sound.setBuffer(buffer);
            sound.setVolume(volume);

            // Randomize pitch slightly for realism
            const detune = 1.0 + (Math.random() * 0.1 - 0.05);
            sound.setPlaybackRate(detune);

            sound.play();
        } else {
            // Fallback if not loaded yet
            console.warn(`SoundManager: Sound for ${type} not loaded yet.`);
        }
    }
}
