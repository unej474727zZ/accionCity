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
            rifle: null,
            tankEngine: null,
            heliEngine: null
        };
        this.ambientAllowed = false;

        // Audio Pools to prevent improved garbage collection issues and mobile limits
        this.pools = {
            pistol: [],
            rifle: []
        };
        this.poolSize = 5;
        this.poolIndex = { pistol: 0, rifle: 0 };

        this.loadSounds();
    }

    loadSoundWithRetry(url, successCallback, retries = 2) {
        const attemptUrl = retries < 2 ? `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}` : url;
        this.audioLoader.load(attemptUrl, successCallback, undefined, (err) => {
            if (retries > 0) {
                console.warn(`[REINTENTO AUDIO] Fallo al cargar ${url}. Intentos: ${retries}. Error:`, err);
                setTimeout(() => this.loadSoundWithRetry(url, successCallback, retries - 1), 500);
            } else {
                console.error(`Error definitivo cargando audio ${url}:`, err);
            }
        });
    }

    loadSounds() {
        // Load Pistol
        this.loadSoundWithRetry(`sounds/pistolaSoundUno.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.pistol = buffer;
            this.createPool('pistol', buffer);
            console.log("SoundManager: Pistol sound loaded + Pool created.");
        });

        // Load Rifle
        this.loadSoundWithRetry(`sounds/rifleSoundUno.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.rifle = buffer;
            this.createPool('rifle', buffer, 0.3);
            console.log("SoundManager: Rifle sound loaded.");
        });

        // TANK: Shots and Crush
        this.loadSoundWithRetry(`sounds/tank-shots.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds['tank-shot'] = buffer;
            this.createPool('tank-shot', buffer, 2, 3);
        });
        this.loadSoundWithRetry(`sounds/tank-crush.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds['tank-crush'] = buffer;
            this.createPool('tank-crush', buffer, 0.6, 3);
        });

        // Loopable Engine Sounds
        this.loadSoundWithRetry(`sounds/tank-moving.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.tankEngine = buffer;
        });
        this.loadSoundWithRetry(`sounds/helicopterHelice1.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.heliEngine = buffer;
        });

        // Footstep
        this.loadSoundWithRetry(`sounds/step.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.step = buffer;
            this.createPool('step', buffer, 0.4, 8); // Pool of 8 for rapid steps
            console.log("SoundManager: Step sound loaded.");
        });

        // Ambient Background Sound
        this.loadSoundWithRetry(`sounds/backSound.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.ambient = buffer;
            this.ambientAudio = new THREE.Audio(this.listener);
            this.ambientAudio.setBuffer(buffer);
            this.ambientAudio.setLoop(true);
            this.ambientAudio.setVolume(0.4); // Aumentado a 0.4 para que se escuche mejor
            
            const startAmbientTrigger = () => {
                if (!window.gameStarted) {
                    console.log("SoundManager: Game not started yet. Holding gameplay background music.");
                    return;
                }
                
                // If the intro music is still playing, wait for it to end before allowing backSound.mp3
                if (window.introAudio && !window.introAudio.paused) {
                    this.ambientAllowed = false;
                    console.log("SoundManager: Waiting for intro.mp3 to finish before playing gameplay ambient sound.");
                    
                    // Remove existing event listener if any, and register one to start backSound
                    window.introAudio.removeEventListener('ended', window.introAudio._onEndedHandler);
                    window.introAudio._onEndedHandler = () => {
                        console.log("SoundManager: intro.mp3 ended. Starting looping gameplay ambient sound.");
                        this.ambientAllowed = true;
                        this.resumeContext();
                    };
                    window.introAudio.addEventListener('ended', window.introAudio._onEndedHandler);
                } else {
                    this.ambientAllowed = true;
                    this.resumeContext();
                }
            };

            // Register global callback or execute immediately if already clicked
            if (window.gameStarted) {
                startAmbientTrigger();
            } else {
                const checkInterval = setInterval(() => {
                    if (window.gameStarted) {
                        clearInterval(checkInterval);
                        startAmbientTrigger();
                    }
                }, 100);
            }
            
            console.log("SoundManager: Ambient sound loaded.");
        });

        // Reload Sound
        this.loadSoundWithRetry(`sounds/reload.mp3?v=${Date.now()}`, (buffer) => {
            this.sounds.reload = buffer;
            this.createPool('reload', buffer, 1.0, 2); // Small pool is enough
            console.log("SoundManager: Reload sound loaded.");
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

    playStep() {
        // Vary the pitch slightly so it doesn't sound like a machine gun
        this.playPool('step', 1.0 + (Math.random() * 0.15 - 0.05));
    }

    playReload() {
        this.playPool('reload', 1.0);
    }

    playPool(type, pitch = 1.0) {
        this.resumeContext();

        if (!this.pools[type] || this.pools[type].length === 0) return;

        const index = this.poolIndex[type];
        const sound = this.pools[type][index];

        if (sound.isPlaying) sound.stop();
        sound.setPlaybackRate(pitch);
        sound.play();

        this.poolIndex[type] = (index + 1) % this.pools[type].length;
    }

    // Explicitly resume audio context and start ambient music
    resumeContext() {
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume().then(() => {
                if (this.ambientAllowed && this.ambientAudio && !this.ambientAudio.isPlaying) {
                    this.ambientAudio.play();
                }
            });
        } else {
            if (this.ambientAllowed && this.ambientAudio && !this.ambientAudio.isPlaying) {
                this.ambientAudio.play();
            }
        }
    }

    // ENGINE SOUNDS (POSITIONAL & LOOPING)
    createEngineSound(mesh, type, volume = 0.5) {
        const buffer = (type === 'tank') ? this.sounds.tankEngine : this.sounds.heliEngine;
        if (!buffer) return null;

        const sound = new THREE.PositionalAudio(this.listener);
        sound.setBuffer(buffer);
        sound.setLoop(true);
        sound.setVolume(volume);
        sound.setRefDistance(10);
        mesh.add(sound);
        return sound;
    }

    // LEGACY / UTILITY / SPATIAL EXPLOSIONS
    playExplosion(pos) {
        if (!pos || !this.camera) {
            this.playTankShot();
            return;
        }

        const dist = this.camera.position.distanceTo(pos);
        const maxDist = 800; // Far hear far, close hear close
        if (dist > maxDist) return;

        let vol = 1.0 - (dist / maxDist);
        vol = Math.max(0.01, vol * vol); // Quadratic falloff

        // Resume context if needed
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
            if (this.ambientAudio && !this.ambientAudio.isPlaying) {
                this.ambientAudio.play();
            }
        }

        const type = 'tank-shot';
        if (!this.pools[type] || this.pools[type].length === 0) return;

        const index = this.poolIndex[type];
        const sound = this.pools[type][index];

        if (sound.isPlaying) sound.stop();
        sound.setVolume(vol * 2.0); // Boost base volume for bombs to ensure impact
        sound.setPlaybackRate(0.8 + Math.random() * 0.2); // Lower pitch for bigger boom
        sound.play();

        this.poolIndex[type] = (index + 1) % this.pools[type].length;
    }
}
