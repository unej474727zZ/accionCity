import * as THREE from 'three';
import nipplejs from 'nipplejs';

export class CharacterController {
    constructor(scene, camera, assets, world) {
        this.scene = scene;
        this.camera = camera;
        this.assets = assets;
        this.world = world;

        // Debug UI removed per user request

        this.mesh = null;
        this.animations = {};
        this.actions = {};
        this.activeAction = null;
        this.isDriving = false; // New State
        this._vehicle = null;   // Current Vehicle (Internal state for getter)
        this.state = 'idle'; // idle, walk, run, backward
        this.isJumping = false;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            spaceHeld: false,
            fire: false,
            ads: false,
            elevate: false,
            descend: false
        };
        this.gamepadJumpHeld = false;

        this.walkSpeed = 5;
        this.runSpeed = 15.0; // Increased by another 20%
        this.rotationSpeed = 2; // radians per second

        // Camera settings
        this.cameraDistance = 3.0; // Dynamic zoom distance (0.1 = First Person, >1 = Third Person) 

        // Physics Constants
        this.gravity = 30.0;
        this.jumpForce = 15.0; // High jump for parkour
        this.velocityY = 0;
        this.isGrounded = false;
        this.lastJumpTime = 0;

        // Joystick state
        this.joystickValues = {
            linear: 0,  // forward/backward (-1 to 1)
            angular: 0, // left/right strafe (-1 to 1)
            lookX: 0,   // yaw rotation speed
            lookY: 0    // pitch rotation speed
        };

        // Collision & Ground Detection
        this.raycaster = new THREE.Raycaster(); // For walls
        this.raycaster.far = 5;

        this.groundRaycaster = new THREE.Raycaster(); // For floor/roofs
        this.groundRaycaster.ray.direction.set(0, -1, 0);

        this.colliders = []; // Will be populated by World
        this.remoteColliders = []; // Remote Players for collision

        // Camera Shake State
        this.shakeIntensity = 0;
        this.shakeDuration = 0;
        this.shakeTimer = 0;

        this.init();
    }

    get vehicle() {
        return this._vehicle;
    }

    set vehicle(v) {
        this._vehicle = v;
    }

    init() {
        // 1. Setup Mesh
        const idleGLTF = this.assets['idle'];

        if (idleGLTF) {
            // Normal path: Load GLTF
            this.mesh = idleGLTF.scene; // Use the scene directly

            // Enable shadows and disable frustum culling
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // FIX: Prevent bounding-box culling glitches on SkinnedMeshes!
                    child.frustumCulled = false;
                }
            });

            // 2. Setup Animations (Only if GLTF exists)
            this.mixer = new THREE.AnimationMixer(this.mesh);
            this.animations['idle'] = this.getClip(this.assets['idle'], 'idle');

            // Fix: Create Dummy Idle if missing (prevents crash loops)
            if (!this.animations['idle']) {
                console.warn("⚠️ No Idle animation found in file. Creating dummy static clip.");
                this.animations['idle'] = new THREE.AnimationClip('idle', 1, []);
            }

            this.animations['walk'] = this.getClip(this.assets['walk'], 'walk');
            this.animations['run'] = this.getClip(this.assets['run'], 'run');
            this.animations['backward'] = this.getClip(this.assets['backward'], 'backward');
            this.animations['jump'] = this.getClip(this.assets['jump'], 'jump');

            // Fix: Load Driving Animation
            this.animations['driving'] = this.getClip(this.assets['driving'], 'driving');
            if (!this.animations['driving'] && this.assets['driving']) {
                // Fallback if getClip fails but asset exists
                if (this.assets['driving'].animations && this.assets['driving'].animations.length > 0) {
                    this.animations['driving'] = this.assets['driving'].animations[0];
                }
            }
            if (!this.animations['driving']) console.warn("Driving animation still missing after init load attempt.");

            // 3. WEAPON MASKS (Upper Body Only)
            // Create specific upper-body clips for each weapon to layer over walking.

            const upperBodyBones = ['Spine', 'Neck', 'Head', 'Shoulder', 'Arm', 'Hand', 'ForeArm'];

            // A) RIFLE MASK (from FiringRifle.glb)
            const rifleClipRaw = this.getClip(this.assets['firing'], 'firing') || (this.assets['firing'] ? this.assets['firing'].animations[0] : null);
            if (rifleClipRaw) {
                const newTracks = [];
                rifleClipRaw.tracks.forEach(track => {
                    const boneName = track.name.split('.')[0];
                    if (upperBodyBones.some(b => boneName.includes(b))) newTracks.push(track);
                });
                this.animations['firing'] = new THREE.AnimationClip('firing_upper', -1, newTracks);
            }

            // B) PISTOL MASK (from shooting.glb)
            // User reported shooting.glb plays well on upper body but freezes legs. So we filter it too.
            const pistolClipRaw = this.getClip(this.assets['shooting'], 'shoot_walk') || (this.assets['shooting'] ? this.assets['shooting'].animations[0] : null);
            if (pistolClipRaw) {
                const newTracks = [];
                pistolClipRaw.tracks.forEach(track => {
                    const boneName = track.name.split('.')[0].toLowerCase();
                    // Upper body bones + Mixamo prefixes
                    const isUpper = ['spine', 'neck', 'head', 'shoulder', 'arm', 'hand', 'forearm'].some(b => boneName.includes(b));
                    if (isUpper) newTracks.push(track);
                });
                this.animations['pistol_upper'] = new THREE.AnimationClip('pistol_upper', -1, newTracks);
            }

            // Start idle
            // Start idle (Safe now due to dummy clip)
            this.playAnimation('idle');

            // Global Mouse Listeners for Fire/ADS
            window.addEventListener('mousedown', (e) => {
                if (e.button === 0) this.keys.fire = true;
                if (e.button === 2) this.keys.ads = true;
            });
            window.addEventListener('mouseup', (e) => {
                if (e.button === 0) this.keys.fire = false;
                if (e.button === 2) this.keys.ads = false;
            });
            window.addEventListener('contextmenu', (e) => e.preventDefault());

            // Mouse Wheel camera zoom removed (Handled by World.js wheel listener)

        } else {
            // Fallback path: Create Box
            console.warn("Character asset missing, using Fallback Box.");
            const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.5);
            const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
            this.mesh = new THREE.Mesh(geometry, material);
            // No animations (mixer stays null)
        }

        // User requested: "Spawn near the tank"
        this.mesh.position.set(-295, 5, 5);
        this.yaw = 0;
        console.log("Spawned at Cluster:", this.mesh.position);

        /* DISABLED PERSISTENCE FOR NOW
        const savedPos = JSON.parse(localStorage.getItem('playerPos'));
        if (savedPos) {
            this.mesh.position.set(savedPos.x, savedPos.y, savedPos.z);
            this.yaw = savedPos.yaw || 0;
        } 
        */

        this.scene.add(this.mesh);

        // Auto-Save Position Interval
        setInterval(() => {
            if (this.mesh) {
                const pos = {
                    x: this.mesh.position.x,
                    y: this.mesh.position.y,
                    z: this.mesh.position.z,
                    yaw: this.yaw
                };
                localStorage.setItem('playerPos', JSON.stringify(pos));
            }
        }, 1000);

        // 3. Setup Input (Keyboard) - Global Window listeners are more robust for Shift+Arrow combos
        window.addEventListener('keydown', (e) => this.onKeyDown(e));
        window.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse look control setup
        this.yaw = 0;
        this.pitch = 0;
        this.aimYaw = 0;
        this.aimPitch = 0;

        // Zoom State (Target FOV)
        this.desiredFOV = 75;

        document.addEventListener('mousemove', (e) => this.onMouseMove(e));

        // Pointer Lock (Left Click)
        // Pointer Lock (Left Click)
        document.addEventListener('click', () => {
            // FIX: Do not lock pointer if in Inspection Mode
            if (this.world && this.world.isInspectionMode) return;

            if (!('ontouchstart' in window)) {
                document.body.requestPointerLock();
            }
        });

        // Zoom Input (Mouse Wheel - Incremental)
        // Zoom Input removed (Handled by World.js wheel listener)

        // Prevent Context Menu on Right Click (still good to keep)
        document.addEventListener('contextmenu', e => e.preventDefault());

        // 4. Setup Input (Mobile Joysticks)
        this.initJoysticks();

        // Noclip Toggle (G)
        this.noclip = false;
        this.noclipDebounce = false;
        document.addEventListener('keydown', (e) => {
            if (e.code === 'KeyG' && !this.noclipDebounce) {
                this.noclip = !this.noclip;
                this.noclipDebounce = true;
                console.log("👻 GHOST MODE: " + (this.noclip ? "ON" : "OFF"));
                setTimeout(() => this.noclipDebounce = false, 500);
            }
        });
    }


    initJoysticks() {
        // --- PSP CONTROLS SETUP ---

        // --- LEFT JOYSTICK (NippleJS) ---
        const zoneJoystick = document.getElementById('zone_joystick');
        if (zoneJoystick && ('ontouchstart' in window || navigator.maxTouchPoints > 0)) {
            const manager = nipplejs.create({
                zone: zoneJoystick,
                mode: 'static',
                position: { left: '50%', top: '50%' },
                color: 'white',
                size: 100
            });

            manager.on('move', (evt, data) => {
                if (!data || !data.vector) return;
                const threshold = 0.2; // Deadzone
                // NippleJS vector: UP is positive Y, RIGHT is positive X
                const vx = isFinite(data.vector.x) ? data.vector.x : 0;
                const vy = isFinite(data.vector.y) ? data.vector.y : 0;

                this.keys.forward = vy > threshold;
                this.keys.backward = vy < -threshold;
                // Changed from Right/Left strafing to Turn Right/Left
                this.keys.turnRight = vx > threshold;
                this.keys.turnLeft = vx < -threshold;
                // Keep strafe false for joystick
                this.keys.right = false;
                this.keys.left = false;
            });

            manager.on('end', () => {
                this.keys.forward = false;
                this.keys.backward = false;
                this.keys.turnLeft = false;
                this.keys.turnRight = false;
            });
        }

        // Right Zone (Camera Look) - Touch Drag (Background)
        const zoneRight = document.getElementById('zone_right');
        if (zoneRight) {
            let lookTouchId = null;
            let lastX, lastY;

            const handleStart = (e) => {
                // e.preventDefault(); // Don't prevent default here? Might block other things? 
                // Actually, for a look zone, we usually WANT to prevent scrolling.

                // Find the touch that started on this element
                const touch = e.changedTouches[0];
                if (touch) {
                    lookTouchId = touch.identifier;
                    lastX = touch.clientX;
                    lastY = touch.clientY;
                }
            };

            const handleMove = (e) => {
                if (lookTouchId === null) return;

                // Find our tracked touch
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const touch = e.changedTouches[i];
                    if (touch.identifier === lookTouchId) {
                        const cx = touch.clientX;
                        const cy = touch.clientY;
                        const dx = cx - lastX;
                        const dy = cy - lastY;

                        const sens = 0.005;
                        this.yaw -= dx * sens;
                        this.pitch -= dy * sens;
                        // Restrict Pitch to prevent looking too far up/down and clipping the model
                        this.pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.pitch));

                        lastX = cx;
                        lastY = cy;
                        break;
                    }
                }
            };

            const handleEnd = (e) => {
                if (lookTouchId === null) return;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === lookTouchId) {
                        lookTouchId = null;
                        break;
                    }
                }
            };

            zoneRight.addEventListener('touchstart', handleStart, { passive: false });
            zoneRight.addEventListener('touchmove', handleMove, { passive: false });
            zoneRight.addEventListener('touchend', handleEnd, { passive: false });
            zoneRight.addEventListener('touchcancel', handleEnd, { passive: false });
        }

        // 3. Action Buttons Binding helper
        const bindBtn = (id, onStart, onEnd) => {
            const btn = document.getElementById(id);
            if (btn) {
                // Use pointer events or touch events? Touch is strict.
                btn.addEventListener('touchstart', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onStart) onStart();
                }, { passive: false });

                btn.addEventListener('touchend', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onEnd) onEnd();
                }, { passive: false });

                // Mouse fallback
                btn.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onStart) onStart();
                });
                btn.addEventListener('mouseup', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (onEnd) onEnd();
                });

                // Block click propagation (Fixes PointerLock spin)
                btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
            }
        };

        // --- PSP ACTIONS MAPPING ---

        // L BUTTON -> NIGHT VISION / PHOTO MODE TOGGLE (Currently Night Vision)
        bindBtn('btn-l', () => {
            if (this.world) this.world.toggleNightVision();
        }, null);

        // R BUTTON -> FIRE
        bindBtn('btn-r', () => {
            this.keys.fire = true;
            if (this.weaponManager) this.weaponManager.shoot();
        }, () => {
            this.keys.fire = false;
        });

        // "X" (Cross) -> INTERACT (VEHICLE) OR JUMP
        bindBtn('btn-x', () => {
            // Let X be the primary action:
            if (this.isDriving) {
                if (this.world && this.world.vehicleManager) {
                    this.world.vehicleManager.exitVehicle();
                }
                return;
            }

            let enteredVehicle = false;
            if (this.world && this.world.vehicleManager) {
                const nearest = this.world.vehicleManager.findNearestVehicle(this.mesh.position);
                if (nearest) {
                    this.world.vehicleManager.enterVehicle(nearest);
                    enteredVehicle = true;
                }
            }
            if (!enteredVehicle) {
                this.triggerJump('touch');
            }
        }, null);

        // "O" (Circle) -> LASER
        bindBtn('btn-cir', () => {
            if (this.weaponManager) this.weaponManager.toggleLaser();
        }, null);

        // "Triangle" (Y equivalent) -> CHANGE WEAPON
        bindBtn('btn-tri', () => {
            if (this.weaponManager) this.weaponManager.cycleWeapon();
        }, null);

        // "Square" (B equivalent) -> SPRINT
        bindBtn('btn-sq', () => this.keys.run = true, () => this.keys.run = false);


        // --- RIGHT D-PAD (ZOOM CONTROL) ---
        // Instead of camera look, map this to zoom
        const btnCamUp = document.getElementById('btn-cam-up');
        const btnCamDown = document.getElementById('btn-cam-down');

        if (btnCamUp) {
            btnCamUp.addEventListener('touchstart', (e) => { e.preventDefault(); this.desiredFOV = 30; }, { passive: false });
            btnCamUp.addEventListener('mousedown', (e) => { e.preventDefault(); this.desiredFOV = 30; });
        }
        if (btnCamDown) {
            btnCamDown.addEventListener('touchstart', (e) => { e.preventDefault(); this.desiredFOV = 70; }, { passive: false });
            btnCamDown.addEventListener('mousedown', (e) => { e.preventDefault(); this.desiredFOV = 70; });
        }


        // SELECT -> ZOOM (Toggle) (Now handled by Right D-Pad, let's keep it just in case)
        bindBtn('btn-select', () => {
            // Unused or map to something else
        }, null);

        // START -> PAUSE / TOGGLE UI
        bindBtn('btn-start', () => {
            // User requested Start to be different from Map.
            // Mapping to UI Toggle (Cinematic/Pause feel)
            if (this.world && this.world.toggleUI) {
                this.world.toggleUI();
            } else {
                console.log("Start Pressed - UI Toggle not available");
            }
        }, null);

        // VR MODE TOGGLE
        bindBtn('btn-vr', () => {
            if (this.world && this.world.toggleVR) {
                this.world.toggleVR();
            }
        }, null);

        // --- EXTRA TOGGLES ---

        // CHAT TOGGLE
        bindBtn('btn-chat-toggle', () => {
            const chat = document.getElementById('chat-container');
            if (chat) chat.style.display = (chat.style.display === 'none') ? 'flex' : 'none';
        }, null);

        // MAP TOGGLE (Button) - Now toggles Mode instead of just visibility
        bindBtn('btn-map-toggle', () => {
            if (this.world && this.world.minimap) {
                this.world.minimap.toggleUI(); // This toggles .isFullMap

                // Mirror KeyM logic for Pointer Lock
                if (this.world.minimap.isFullMap) {
                    document.exitPointerLock();
                } else {
                    document.body.requestPointerLock();
                }
            }
        }, null);

        // EXTRA: RIGHT D-PAD removed from Camera Control as per user request
        // (Zoom is now handled explicitly by btn-cam-up/down)
        const bindCamBtn = (id, key) => {
            const btn = document.getElementById(id);
            if (btn) {
                const handler = (active) => {
                    this.keys[key] = active;
                };
                // Touch
                btn.addEventListener('touchstart', (e) => { e.preventDefault(); handler(true); }, { passive: false });
                btn.addEventListener('touchend', (e) => { e.preventDefault(); handler(false); }, { passive: false });
                // Mouse
                btn.addEventListener('mousedown', (e) => { e.preventDefault(); handler(true); });
                btn.addEventListener('mouseup', (e) => { e.preventDefault(); handler(false); });
                btn.addEventListener('mouseleave', (e) => { e.preventDefault(); handler(false); });
                // Block click propagation (Fixes PointerLock spin)
                btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
            }
        };

        // BIND CAMERA CROSS (To keys used in update loop)
        bindCamBtn('btn-cam-up', 'lookUp');
        bindCamBtn('btn-cam-down', 'lookDown');
        bindCamBtn('btn-cam-left', 'lookLeft');
        bindCamBtn('btn-cam-right', 'lookRight');
    }


    getClip(gltf, fallbackName) {
        if (gltf && gltf.animations && gltf.animations.length > 0) {
            return gltf.animations[0];
        }
        return null;
    }

    setFiring(isActive) {
        if (!this.mixer) return;

        // Determine which mask to use based on weapon
        const isRifle = (this.weaponManager && this.weaponManager.currentWeaponType === 'rifle');
        const targetClipName = isRifle ? 'firing' : 'pistol_upper'; // 'firing' is the rifle mask key
        const otherClipName = isRifle ? 'pistol_upper' : 'firing';

        // Get Actions
        const targetClip = this.animations[targetClipName];
        if (!targetClip) return;
        const targetAction = this.mixer.clipAction(targetClip);

        // Fade OUT the other mask if it's running (e.g. switched weapon while firing)
        const otherClip = this.animations[otherClipName];
        if (otherClip) {
            const otherAction = this.mixer.clipAction(otherClip);
            if (otherAction.isRunning()) otherAction.fadeOut(0.2);
        }

        if (isActive) {
            // Only play if not already playing or fading in
            if (!targetAction.isRunning() || targetAction.getEffectiveWeight() < 0.1) {
                targetAction.reset();
                targetAction.enabled = true;
                targetAction.setLoop(THREE.LoopRepeat);
                targetAction.clampWhenFinished = false;
                // High weight to override arms
                targetAction.setEffectiveWeight(50.0);
                targetAction.play();
                targetAction.fadeIn(0.2);
            }
        } else {
            if (targetAction.isRunning()) {
                targetAction.fadeOut(0.2);
            }
        }
    }


    playAnimation(name, loop = true) {
        if (this.currentAction && this.state === name) return;

        const clip = this.animations[name];
        if (!clip) {
            console.warn(`Animation '${name}' not found! Available:`, Object.keys(this.animations));
            return;
        }

        const action = this.mixer.clipAction(clip);
        action.reset();

        if (loop) {
            action.setLoop(THREE.LoopRepeat);
            action.clampWhenFinished = false;
        } else {
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
        }

        const fadeDuration = 0.5;

        // --- SINCRONIZACIÓN (Eliminar Cojera) ---
        // Si estamos pasando entre walk/run/backward, sincronizamos el tiempo
        if (this.currentAction &&
            (name === 'walk' || name === 'run' || name === 'backward') &&
            (this.state === 'walk' || this.state === 'run' || this.state === 'backward')) {

            // Sincronizar el nuevo clip con el actual para que los pies coincidan
            action.time = this.currentAction.time;
        }

        action.fadeIn(fadeDuration);
        action.play();

        if (this.currentAction) {
            this.currentAction.fadeOut(fadeDuration);
        }

        this.currentAction = action;
        this.state = name;
    }

    triggerJump(source = 'unknown') {
        // Logic: Can only jump if on ground AND cooldown passed
        const now = Date.now();
        if (this.isGrounded && (now - this.lastJumpTime > 500)) { // 500ms cooldown
            this.velocityY = this.jumpForce;
            this.isGrounded = false;
            this.isJumping = true; // For animation logic
            this.lastJumpTime = now;
            console.log(`JUMP! Force applied. Source: ${source}`);
        } else {
            // console.log("Jump ignored: Grounded=", this.isGrounded, "Cooldown=", (now - this.lastJumpTime));
        }
    }

    shakeCamera(intensity, duration) {
        this.shakeIntensity = intensity;
        this.shakeDuration = duration;
        this.shakeTimer = duration;
    }

    onKeyDown(e) {
        // console.log("Key pressed:", e.code); // DEBUG: Uncomment if inputs are weird
        // Zoom Map (NumPad and Keyboard + / -)
        if (this.world && this.world.minimap && this.world.minimap.isFullMap) {
            if (e.code === 'NumpadAdd' || e.code === 'Equal') {
                this.world.updateMinimap3DZoom(0.2); // Zoom real In
                return;
            }
            if (e.code === 'NumpadSubtract' || e.code === 'Minus') {
                this.world.updateMinimap3DZoom(-0.2); // Zoom real Out
                return;
            }
        }

        // HIGH PRIORITY CAMERA LOOK (Arrow Keys - Global Robust Check)
        const isUp = (e.key === 'ArrowUp' || e.code === 'ArrowUp' || e.key === 'Up' || e.code === 'Numpad8');
        const isDown = (e.key === 'ArrowDown' || e.code === 'ArrowDown' || e.key === 'Down' || e.code === 'Numpad2');
        const isLeft = (e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.key === 'Left' || e.code === 'Numpad4');
        const isRight = (e.key === 'ArrowRight' || e.code === 'ArrowRight' || e.key === 'Right' || e.code === 'Numpad6');

        if (isUp) { e.preventDefault(); this.keys.lookUp = true; return; }
        if (isDown) { e.preventDefault(); this.keys.lookDown = true; return; }
        if (isLeft) { e.preventDefault(); this.keys.lookLeft = true; return; }
        if (isRight) { e.preventDefault(); this.keys.lookRight = true; return; }

        switch (e.code) {
            case 'Space':
                // Keyboard auto-repeats, so we guard against rapid fire
                if (!this.keys.spaceHeld) {
                    if (this.isDriving) {
                        if (this.world && this.world.vehicleManager) {
                            // SAFETY: If we think we are driving but the manager has no vehicle, force reset
                            if (!this.world.vehicleManager.currentVehicle) {
                                console.warn("Character stuck in driving state without vehicle. Forcing reset.");
                                this.setDriving(false);
                            } else {
                                this.world.vehicleManager.exitVehicle();
                            }
                        }
                    } else {
                        let enteredVehicle = false;
                        if (this.world && this.world.vehicleManager) {
                            const nearest = this.world.vehicleManager.findNearestVehicle(this.mesh.position, 12.0);
                            if (nearest) {
                                this.world.vehicleManager.enterVehicle(nearest);
                                // SYNC AIM WITH CAMERA ON ENTRY (Keyboard)
                                this.aimYaw = this.yaw;
                                this.aimPitch = this.pitch;
                                enteredVehicle = true;
                            }
                        }
                        if (!enteredVehicle) {
                            this.triggerJump('keyboard');
                        }
                    }
                    this.keys.spaceHeld = true;
                }
                break;
            case 'KeyW': this.keys.forward = true; break;
            case 'KeyS': this.keys.backward = true; break;
            case 'KeyA': this.keys.left = true; break;
            case 'KeyD': this.keys.right = true; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.run = true;
                this.keys.isShiftPressed = true;
                break;
            case 'KeyH':
            case 'KeyL': this.keys.elevate = true; break;
            case 'KeyJ': this.keys.descend = true; break;

            case 'KeyF': this.keys.fire = true; break;
            case 'KeyV': this.keys.ads = true; break;

            // ACTION TOGGLES (PC Keyboard) - Trigger instantly to catch fast taps
            case 'KeyL':
                if (!e.repeat && this.weaponManager) this.weaponManager.toggleLaser();
                break;
            case 'KeyT':
                if (!e.repeat && this.weaponManager) this.weaponManager.toggleHolster();
                break;
            case 'KeyN':
                if (!e.repeat && this.world) {
                    this.world.toggleNightVision();
                }
                break;
            case 'KeyP':
                if (!e.repeat && this.world) this.world.toggleUI();
                break;
            case 'KeyR':
                if (!e.repeat && this.weaponManager) this.weaponManager.cycleWeapon();
                break;
                break;
        }
    }

    onKeyUp(e) {
        // HIGH PRIORITY CAMERA LOOK (Arrow Keys - Global Robust Check)
        const isUp = (e.key === 'ArrowUp' || e.code === 'ArrowUp' || e.key === 'Up' || e.code === 'Numpad8');
        const isDown = (e.key === 'ArrowDown' || e.code === 'ArrowDown' || e.key === 'Down' || e.code === 'Numpad2');
        const isLeft = (e.key === 'ArrowLeft' || e.code === 'ArrowLeft' || e.key === 'Left' || e.code === 'Numpad4');
        const isRight = (e.key === 'ArrowRight' || e.code === 'ArrowRight' || e.key === 'Right' || e.code === 'Numpad6');

        if (isUp) { e.preventDefault(); this.keys.lookUp = false; return; }
        if (isDown) { e.preventDefault(); this.keys.lookDown = false; return; }
        if (isLeft) { e.preventDefault(); this.keys.lookLeft = false; return; }
        if (isRight) { e.preventDefault(); this.keys.lookRight = false; return; }

        switch (e.code) {
            case 'KeyW': this.keys.forward = false; break;
            case 'KeyS': this.keys.backward = false; break;
            case 'KeyA': this.keys.left = false; break;
            case 'KeyD': this.keys.right = false; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.run = false;
                this.keys.isShiftPressed = false;
                break;
            case 'KeyH':
            case 'KeyL': this.keys.elevate = false; break;
            case 'KeyJ': this.keys.descend = false; break;
            case 'Space':
                this.keys.spaceHeld = false;
                break;

            case 'KeyF': this.keys.fire = false; break;
            case 'KeyV': this.keys.ads = false; break;

            case 'KeyL':
            case 'KeyT':
            case 'KeyN':
            case 'KeyP':
            case 'KeyR':
                // Handled in keydown instantly
                break;
        }
    }

    onMouseMove(e) {
        if (document.pointerLockElement === document.body) {
            const sens = 0.002;
            const dx = e.movementX * sens;
            const dy = e.movementY * sens;

            this.yaw -= dx;
            this.pitch -= dy;

            // Mouse also updates Aim for vehicles
            this.aimYaw -= dx;
            this.aimPitch -= dy;

            this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));
            this.aimPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.aimPitch));
        }
    }

    update(dt) {
        if (!this.mesh) return;

        // Bloquear movimiento y física en modo inspección, pero mantener animaciones
        if (this.world && this.world.isInspectionMode) {
            if (this.mixer) this.mixer.update(dt);
            return;
        }

        // --- SANITY CHECK (Anti-Crash) ---
        if (!isFinite(this.yaw)) {
            console.warn("[CharacterController] Yaw was NaN, resetting.");
            this.yaw = 0;
        }
        if (!isFinite(this.pitch)) this.pitch = 0;
        if (!isFinite(this.aimYaw)) this.aimYaw = this.yaw;
        if (!isFinite(this.aimPitch)) this.aimPitch = this.pitch;

        if (!isFinite(this.mesh.position.x) || !isFinite(this.mesh.position.y) || !isFinite(this.mesh.position.z)) {
            console.warn("[CharacterController] Position was NaN, rescuing.");
            // Try to find current vehicle or fallback to origin
            if (this.isDriving && this.vehicle && this.vehicle.mesh) {
                this.mesh.position.set(0, 0, 0); // Local pos is 0 when child of vehicle
            } else {
                this.mesh.position.set(0, 5, 0);
            }
        }

        // 1. CLEAR PREVIOUS INPUT STATE
        this.inputVector = { x: 0, y: 0 };
        this.isRunning = this.keys.run || this.keys.isShiftPressed;

        // 2. UPDATE LOOK ROTATION (Rotation should always work)
        const joyLookSpeed = 0.75;
        this.yaw -= this.joystickValues.lookX * joyLookSpeed * dt;
        this.pitch += this.joystickValues.lookY * joyLookSpeed * dt;

        // Rotación más rápida al correr para compensar la inercia visual
        const keyLookSpeed = (this.isRunning ? 3.5 : 2.0) * dt;

        // Direcciones unificadas con el ratón:
        if (this.keys.lookLeft) this.yaw += keyLookSpeed; // Left Arrow -> Turn Left (CCW)
        if (this.keys.lookRight) this.yaw -= keyLookSpeed; // Right Arrow -> Turn Right (CW)
        if (this.keys.lookUp) this.pitch += keyLookSpeed;
        if (this.keys.lookDown) this.pitch -= keyLookSpeed;

        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));

        // 3. COLLECT MOVEMENT INPUTS (For both Walking and Driving)
        let fInput = 0;
        let sInput = 0;

        // Gamepad logic
        const activeGamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let gamepad = null;
        for (let i = 0; i < activeGamepads.length; i++) { if (activeGamepads[i]) { gamepad = activeGamepads[i]; break; } }
        if (gamepad) {
            const dz = 0.1;

            // Left Stick (Movement) - Usually Axes 0 (X) and 1 (Y)
            if (Math.abs(gamepad.axes[1]) > dz) fInput -= gamepad.axes[1];
            if (Math.abs(gamepad.axes[0]) > dz) this.yaw -= gamepad.axes[0] * 2.0 * dt;

            // Right Stick (Camera Look) 
            // Generic Android controllers often put Right Stick X on 2 or 4. Right Stick Y on 3 or 5.
            const filterAxis = (val) => (val !== undefined && Math.abs(val) > dz && Math.abs(val) < 0.99) ? val : 0;

            // For X (Left/Right), we check axis 2 primarily. If dead, check axis 4.
            let rightX = filterAxis(gamepad.axes[2]);
            if (!rightX) rightX = filterAxis(gamepad.axes[4]); // T3 sometimes uses 4 for X

            // For Y (Up/Down), we check axis 5 primarily (user reported UP triggered Zoom -> axis 5!). If dead, check 3.
            let rightY = filterAxis(gamepad.axes[5]);
            if (!rightY) rightY = filterAxis(gamepad.axes[3]);

            if (Math.abs(rightX) > 0) {
                this.yaw -= rightX * 2.5 * dt;
                if (this.isDriving) this.aimYaw -= rightX * 2.5 * dt;
            }
            if (Math.abs(rightY) > 0) {
                // Pitch needs to be mapped correctly. If UP is positive on Axis 5, this might be inverted.
                // Standard: UP is negative Y. So pushing UP (-Y) should increase Pitch (look up).
                this.pitch -= rightY * 1.5 * dt;
                this.pitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.pitch));
            }

            // --- EMPIRICAL PHYSICAL MAPPINGS FOR USER'S CONTROLLER ---
            // A = 0
            // X = 3
            // Y = 4
            // L = 8
            // R = 9 (Assumed)

            // RUN (User wants Y to run. Controller Y is index 4)
            if (gamepad.buttons[4] && gamepad.buttons[4].pressed) this.isRunning = true;

            // JUMP / VEHICLE (User wants X to jump/ride. Controller X is index 3)
            if (gamepad && gamepad.buttons[3] && gamepad.buttons[3].pressed) {
                if (!this._gamepadJumpHeld) {
                    if (this.isDriving) {
                        if (this.world && this.world.vehicleManager) {
                            if (!this.world.vehicleManager.currentVehicle) {
                                this.setDriving(false);
                            } else {
                                this.world.vehicleManager.exitVehicle();
                            }
                        }
                    } else {
                        let enteredVehicle = false;
                        if (this.world && this.world.vehicleManager) {
                            // Expand interaction radius to 12.0 meters to ensure the huge collision hull doesn't block entry
                            const nearest = this.world.vehicleManager.findNearestVehicle(this.mesh.position, 12.0);
                            if (nearest) {
                                this.world.vehicleManager.enterVehicle(nearest);
                                // SYNC AIM WITH CAMERA ON ENTRY (Gamepad)
                                this.aimYaw = this.yaw;
                                this.aimPitch = this.pitch;
                                enteredVehicle = true;
                            }
                        }
                        if (!enteredVehicle && !this.isDriving) this.triggerJump('gamepad');
                    }
                    this._gamepadJumpHeld = true;
                }
            } else {
                this._gamepadJumpHeld = false;
            }
        }

        // Keyboard/Joystick logic
        if (this.keys.forward) fInput += 1;
        if (this.keys.backward) fInput -= 1;
        if (this.keys.left) sInput -= 1;
        if (this.keys.right) sInput += 1;

        fInput += this.joystickValues.linear;
        sInput += this.joystickValues.angular;

        this.inputVector.y = Math.max(-1, Math.min(1, fInput));
        this.inputVector.x = Math.max(-1, Math.min(1, sInput));

        // 3.5 RESTORE ACTION INPUTS
        if (this.weaponManager) {
            // Firing logic
            const shootInput = this.keys.fire || (gamepad && gamepad.buttons[9] && gamepad.buttons[9].pressed);
            this.weaponManager.isFiring = shootInput;

            // TANK FIRE HOOK: If driving a tank and firing, trigger the cannon!
            if (this.isDriving && this.vehicle && this.vehicle.type === 'tank' && shootInput) {
                this.weaponManager.fireTankCannon();
            }

            // Cycle Weapon (Cruzeta abajo works! D-Pad Down = 13)
            if (this.keys.weaponCycle || (gamepad && gamepad.buttons[13] && gamepad.buttons[13].pressed)) {
                if (!this._weaponCycleHeld) {
                    this.weaponManager.cycleWeapon();
                    this._weaponCycleHeld = true;
                }
            } else {
                this._weaponCycleHeld = false;
            }

            // Toggle Laser (Gamepad only)
            if (gamepad && gamepad.buttons[0] && gamepad.buttons[0].pressed) {
                if (!this._laserToggleHeld) {
                    this.weaponManager.toggleLaser();
                    this._laserToggleHeld = true;
                }
            } else {
                this._laserToggleHeld = false;
            }

            // Toggle Holster (Gamepad reserved for later, e.g. cross down 13 if unused)
            // Left empty for gamepad for now

            // ADS FOV (Zoom using Gamepad Triggers)
            const zoomTriggered = (gamepad && ((gamepad.buttons[7] && gamepad.buttons[7].pressed) || (gamepad.buttons[11] && gamepad.buttons[11].pressed)));

            // Helicopters use Left Click for Guns, Right Click for Missiles
            const isHeli = this.isDriving && this.vehicle && this.vehicle.type === 'helicopter';

            if (isHeli) {
                if (this.keys.fire) this.weaponManager.fireHeliGuns();
                if (this.keys.ads) this.weaponManager.fireHeliMissiles(); // Right click

                // If using gamepad zoom, force 30. Otherwise, let world wheel zoom control it.
                if (zoomTriggered) this.desiredFOV = 30;
                // DO NOT force back to 75 here for heli, so mouse wheel zoom stays!
            } else {
                this.desiredFOV = (this.keys.ads || zoomTriggered) ? 30 : 75;
            }

            // Night Vision (Gamepad L1 = 8)
            if (gamepad && gamepad.buttons[8] && gamepad.buttons[8].pressed) {
                if (!this._nvToggleHeld) {
                    if (this.world) this.world.toggleNightVision();
                    this._nvToggleHeld = true;
                }
            } else {
                this._nvToggleHeld = false;
            }

            // UI Toggle / Photo Mode (Gamepad Select = 10 or 6)
            if (gamepad && ((gamepad.buttons[10] && gamepad.buttons[10].pressed) || (gamepad.buttons[6] && gamepad.buttons[6].pressed))) {
                if (!this._uiToggleHeld) {
                    if (this.world) this.world.toggleUI(); // This toggles debug console and mobile controls
                    this._uiToggleHeld = true;
                }
            } else {
                this._uiToggleHeld = false;
            }

            // JUMP / VEHICLE (User wants X to jump/ride. Controller X is index 3)
            if (gamepad && gamepad.buttons[3] && gamepad.buttons[3].pressed) {
                if (!this._gamepadJumpHeld) {
                    if (this.isDriving) {
                        if (this.world && this.world.vehicleManager) this.world.vehicleManager.exitVehicle();
                    } else {
                        let enteredVehicle = false;
                        if (this.world && this.world.vehicleManager) {
                            const nearest = this.world.vehicleManager.findNearestVehicle(this.mesh.position, 12.0);
                            if (nearest) {
                                this.world.vehicleManager.enterVehicle(nearest);
                                // SYNC AIM WITH CAMERA ON ENTRY (Gamepad)
                                this.aimYaw = this.yaw;
                                this.aimPitch = this.pitch;
                                enteredVehicle = true;
                            }
                        }
                        if (!enteredVehicle && !this.isDriving) this.triggerJump('gamepad');
                    }
                    this._gamepadJumpHeld = true;
                }
            } else {
                this._gamepadJumpHeld = false;
            }
        }

        // Unified update loop skips walking in the physics block below

        // 5. UPDATE MOVEMENT VECTORS
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        const right = new THREE.Vector3(1, 0, 0);
        right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        // WALKING MODE CONTINUES
        if (!this.isDriving) {
            this.mesh.rotation.y = this.yaw + Math.PI;

            // --- Normal Character Update ---
            let speed = 0;
            let nextState = 'idle';

            if (this.isJumping) {
                nextState = 'jump';
            }

            const forwardInput = this.inputVector.y;
            const strafeInput = this.inputVector.x;

            // ... action buttons removed from here (handled at top) ...

            const isMoving = Math.abs(forwardInput) > 0.1 || Math.abs(strafeInput) > 0.1;
            const isRunning = this.isRunning;

            if (isMoving) {
                if (Math.abs(forwardInput) > 0.1) {
                    if (forwardInput > 0.1) {
                        if (!this.isJumping) nextState = isRunning ? 'run' : 'walk';
                        speed = isRunning ? this.runSpeed : this.walkSpeed;
                    } else {
                        if (!this.isJumping) nextState = 'backward';
                        speed = -this.walkSpeed * 0.6;
                    }
                    speed *= Math.abs(forwardInput);
                } else {
                    // Strafe only
                    if (!this.isJumping) nextState = isRunning ? 'run' : 'walk';
                    speed = (isRunning ? this.runSpeed : this.walkSpeed) * Math.abs(strafeInput);
                }
            } else {
                if (!this.isJumping) nextState = 'idle';
                speed = 0;
            }

            // --- NOCLIP / GHOST MODE ---
            if (this.noclip) {
                const flySpeed = this.runSpeed * 2;
                const moveVec = new THREE.Vector3(0, 0, 0);

                if (this.keys.spaceHeld || this.keys[' ']) this.mesh.position.y += flySpeed * dt;
                if (this.keys.isShiftPressed || this.keys['shift']) this.mesh.position.y -= flySpeed * dt;

                const moveStep = forward.clone().multiplyScalar(forwardInput * flySpeed * dt)
                    .add(right.clone().multiplyScalar(strafeInput * flySpeed * dt));

                this.mesh.position.add(moveStep);
                return; // SKIP PHYSICS
            }

            // 3. PHYSICS & GRAVITY
            const rayOrigin = this.mesh.position.clone();
            rayOrigin.y += 1.0;
            this.groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
            const intersects = this.groundRaycaster.intersectObjects(this.colliders, true);

            let groundHeight = -99999;
            let foundGround = false;

            if (intersects.length > 0) {
                const hit = intersects[0];
                if (hit.distance < 2.5) {
                    groundHeight = hit.point.y;
                    foundGround = true;
                }
            }

            // State Machine
            if (this.isJumping) {
                this.velocityY -= this.gravity * dt;
                this.mesh.position.y += this.velocityY * dt;
                this.isGrounded = false;
                if (this.velocityY < 0 && foundGround && this.mesh.position.y <= groundHeight + 0.2) {
                    this.mesh.position.y = groundHeight + 0.01;
                    this.isJumping = false;
                    this.isGrounded = true;
                    this.velocityY = 0;
                }
            } else if (this.isGrounded) {
                this.velocityY = 0;
                if (foundGround) {
                    if (this.mesh.position.y - groundHeight < 0.5) {
                        this.mesh.position.y = groundHeight + 0.01;
                    } else {
                        this.isGrounded = false;
                    }
                } else if (speed !== 0) {
                    this.isGrounded = false;
                }
            } else {
                this.velocityY -= this.gravity * dt;
                this.mesh.position.y += this.velocityY * dt;
                if (foundGround && this.mesh.position.y <= groundHeight + 0.2) {
                    this.mesh.position.y = groundHeight + 0.01;
                    this.isGrounded = true;
                    this.velocityY = 0;
                }
                if (this.mesh.position.y < 0) {
                    this.mesh.position.y = 0;
                    this.isGrounded = true;
                    this.velocityY = 0;
                }
            }
            const moveVector = new THREE.Vector3();

            // Add forward/backward
            if (forwardInput !== 0) {
                moveVector.add(forward.multiplyScalar(speed * dt)); // Speed is already signed/scaled
            }

            // Add rotation from joystick
            // Add rotation from joystick
            // Add rotation from joystick
            if (this.keys.turnLeft) {
                const turnAmt = 1.5 * dt;
                this.yaw += turnAmt;
                if (this.isDriving) this.aimYaw -= turnAmt; // Corrected stabilization: Turn tank left, turret target goes right
            }
            if (this.keys.turnRight) {
                const turnAmt = 1.5 * dt;
                this.yaw -= turnAmt;
                if (this.isDriving) this.aimYaw += turnAmt; // Corrected stabilization: Turn tank right, turret target goes left
            }

            // Add strafe (from keyboard A/D)
            if (strafeInput !== 0) {
                moveVector.add(right.multiplyScalar(this.walkSpeed * strafeInput * dt));
            }

            // Checking Walls (Horizontal Collision)
            // Raycast in move direction regarding HEAD and SHOULDERS (Whiskers)
            if (moveVector.length() > 0) {
                let blocked = false;
                const moveDir = moveVector.clone().normalize();

                // Calculate Shoulder Offsets (Left/Right perpendicular to moveDir)
                const rightAx = moveDir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
                const leftAx = rightAx.clone().negate();
                const shoulderWidth = 0.4; // 40cm offset

                const rayOrigins = [
                    // Chest Height
                    this.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)),
                    this.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)).add(rightAx.clone().multiplyScalar(shoulderWidth)),
                    this.mesh.position.clone().add(new THREE.Vector3(0, 1.0, 0)).add(leftAx.clone().multiplyScalar(shoulderWidth)),
                    // Knee/Hip Height
                    this.mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
                    this.mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)).add(rightAx.clone().multiplyScalar(shoulderWidth)),
                    this.mesh.position.clone().add(new THREE.Vector3(0, 0.4, 0)).add(leftAx.clone().multiplyScalar(shoulderWidth)),
                    // Extra Foot Height to catch curbs
                    this.mesh.position.clone().add(new THREE.Vector3(0, 0.1, 0))
                ];

                // Combine environment colliders, remote player colliders, AND VEHICLES!
                const allColliders = [...this.colliders, ...this.remoteColliders];
                if (this.world && this.world.vehicleManager) {
                    this.world.vehicleManager.vehicles.forEach(v => {
                        if (v.mesh) allColliders.push(v.mesh);
                    });
                }
                if (this.world && this.world.npcManager && this.world.npcManager.cars) {
                    this.world.npcManager.cars.forEach(m => {
                        if (m) allColliders.push(m);
                    });
                }

                const dynFar = Math.max(0.6, moveVector.length() + 0.3); // Dynamic length to prevent tunneling
                let closestDist = 999;

                for (const origin of rayOrigins) {
                    this.raycaster.set(origin, moveDir);
                    this.raycaster.far = dynFar;

                    const wallHits = this.raycaster.intersectObjects(allColliders, true);

                    if (wallHits.length > 0) {
                        blocked = true;
                        if (wallHits[0].distance < closestDist) closestDist = wallHits[0].distance;
                    }
                }

                if (blocked) {
                    moveVector.set(0, 0, 0);
                    // Push-out logic: if we manage to overlap a collider, push the character back
                    const playerBumper = 0.5;
                    if (closestDist < playerBumper) {
                        const overlap = playerBumper - closestDist;
                        this.mesh.position.add(moveDir.clone().multiplyScalar(-overlap));
                    }
                }

                // PLAYER-PLAYER COLLISION
                // Check against remote players (Simple Radius Check)
                if (this.remoteColliders.length > 0) {
                    const myPos = this.mesh.position.clone().add(moveVector); // Predicted position
                    const radius = 0.5; // Player radius

                    for (const otherMesh of this.remoteColliders) {
                        if (!otherMesh) continue;
                        // Horizontal distance only
                        const dx = myPos.x - otherMesh.position.x;
                        const dz = myPos.z - otherMesh.position.z;
                        const distSq = dx * dx + dz * dz;

                        if (distSq < (radius * 2) * (radius * 2)) {
                            // Collision!
                            // Push back vector
                            const dist = Math.sqrt(distSq);
                            const pushDir = new THREE.Vector3(dx, 0, dz).normalize();
                            const overlap = (radius * 2) - dist;

                            // Apply push to moveVector (soft collision)
                            moveVector.add(pushDir.multiplyScalar(overlap));
                        }
                    }
                }
            }

            // Apply Move
            this.mesh.position.add(moveVector);

            if (!this.isGrounded) {
                // Loop jump animation while in air
                this.playAnimation('jump', true);
            } else {
                this.playAnimation(nextState);

                // --- ANIMATION SYNC (Prevent Foot Sliding) ---
                if (this.currentAction && (nextState === 'walk' || nextState === 'run' || nextState === 'backward')) {
                    const baseSpeed = (nextState === 'run') ? this.runSpeed : this.walkSpeed;
                    // Escalar la velocidad de la animación para que coincida con el movimiento real
                    // El valor 0.8 es un multiplicador de ajuste fino para estos assets específicos
                    const animScale = (Math.abs(speed) / baseSpeed) * 0.9;
                    this.currentAction.setEffectiveTimeScale(Math.max(0.4, animScale));
                } else if (this.currentAction) {
                    this.currentAction.setEffectiveTimeScale(1.0);
                }
            }
        } // End of !isDriving block

        // 5. Update Animation / View
        if (this.mixer) {
            if (!(this.isDriving && this.vehicle && this.vehicle.type === 'motorcycle')) {
                this.mixer.update(dt);
            }
        }
        if (this.isDriving && this.vehicle) {
            // Character is parented now, just keep it hidden
            this.mesh.visible = (this.vehicle.type === 'motorcycle'); // Show on motorcycle, hide on tank/heli

            if (this.vehicle.type === 'motorcycle') {
                this.updateDrivingPose();
            }
        }
        // Camera update is handled by World.js after the vehicle moves to prevent shuddering

        // Handle Upper Body Firing Mask Visibility
        const useMask = (this.weaponManager && this.weaponManager.isFiring);
        this.setFiring(useMask);

        // Update Radar if in helicopter
        if (this.isDriving && this.vehicle && this.vehicle.type === 'helicopter') {
            this.updateRadar();
        }

        // DEBUG OUTPUT
        const debugEl = document.getElementById('debug-console');
        if (debugEl) {
            let keyStr = "";
            for (let k in this.keys) {
                if (this.keys[k]) keyStr += k + " ";
            }
            const plStatus = (document.pointerLockElement === document.body) ? "ACTIVE" : "OFF";

            debugEl.innerText = `
FPS: ${(1 / dt).toFixed(0)}
YAW: ${this.yaw.toFixed(2)}
PITCH: ${this.pitch.toFixed(2)}
JOY-LOOK X: ${this.joystickValues.lookX.toFixed(2)}
KEYS: ${keyStr}
TOUCHES: ${navigator.maxTouchPoints}
PTR LOCK: ${plStatus}
            `;
        }
    }

    setDriving(isDriving, vehicle, exitPos) {
        this.isDriving = isDriving;
        this._vehicle = vehicle;
        // Removed: this.mesh.position.copy(exitPos) here. 
        // It's now handled after unparenting to ensure world space correctness.

        const radarUI = document.getElementById('heli-radar');
        if (radarUI) {
            radarUI.style.display = (isDriving && vehicle && vehicle.type === 'helicopter') ? 'block' : 'none';
        }

        // Parent/Visibility handling
        if (isDriving && vehicle) {
            vehicle.mesh.add(this.mesh);

            // Use seatOffset from vehicle settings if available, else fallback
            const cfg = this.world?.vehicleManager?.settings?.[vehicle.type];
            if (cfg && cfg.seatOffset) {
                this.mesh.position.copy(cfg.seatOffset);
            } else {
                this.mesh.position.set(0, 0, 0);
            }

            if (vehicle.type === 'tank' || vehicle.type === 'helicopter') {
                this.mesh.visible = false;

                if (vehicle.type === 'tank') {
                    // Sincronización a prueba de fallos:
                    // En lugar de calcular atan2 que puede fallar si los vectores son NaN,
                    // simplemente copiamos la rotación Y del vehículo directamente.
                    let vehicleYaw = 0;
                    if (vehicle.mesh && isFinite(vehicle.mesh.rotation.y)) {
                        // Convertir la rotación del tanque (basada en el eje X original) a la orientación de la cámara
                        vehicleYaw = vehicle.mesh.rotation.y + (Math.PI / 2);
                    }

                    if (!isFinite(vehicleYaw)) vehicleYaw = 0;

                    this.yaw = vehicleYaw;
                    this.aimYaw = vehicleYaw;
                    this.pitch = 0;
                    this.aimPitch = 0;
                }
            } else {
                this.mesh.visible = true;
            }

            if (vehicle.type === 'motorcycle') {
                this.mesh.quaternion.set(0, 0, 0, 1);
            } else {
                this.mesh.quaternion.set(0, 0, 0, 1);
            }
        } else {
            // Unparent FIRST before setting world position
            if (this.world && this.world.scene) {
                this.world.scene.add(this.mesh);
            }

            if (exitPos) {
                this.mesh.position.copy(exitPos);
            }

            this.mesh.visible = true;

            // Also sync aim for other vehicles when exiting
            this.aimYaw = this.yaw;
            this.aimPitch = this.pitch;
        }

        // Reset movement states
        if (isDriving) {
            this.isJumping = false;
            this.isGrounded = true;
            this.velocityY = 0;
            this.state = 'idle';
        }

        // Hide weapons while driving
        if (this.weaponManager && this.weaponManager.currentWeaponMesh) {
            this.weaponManager.currentWeaponMesh.visible = !isDriving;
            if (isDriving) this.weaponManager.stopFiring();
        }

        // Toggle Animation
        if (this.mixer) {
            this.mixer.stopAllAction();
            const animName = isDriving ? 'driving' : 'idle';
            const clip = this.animations[animName] || this.animations['idle'];
            if (clip) {
                const action = this.mixer.clipAction(clip);
                action.reset().fadeIn(0.2).play();
            }
        }
    }

    updateDrivingPose() {
        if (!this.isDriving || !this.mesh) return;

        // Redundant rotation removed to prevent conflict with line 1464


        // Procedural Bone Adjustment (IK-ish)
        const bones = {};
        this.mesh.traverse(child => {
            if (child.isBone) {
                const name = child.name;
                if (!this._loggedBones) console.log("🦴 Bone Found:", name);

                // Use endsWith to prevent 'RightArm' matching 'RightForeArm' and double-assigning
                if (name.endsWith('RightArm')) bones.rArm = child;
                if (name.endsWith('LeftArm')) bones.lArm = child;
                if (name.endsWith('RightForeArm')) bones.rForeArm = child;
                if (name.endsWith('LeftForeArm')) bones.lForeArm = child;
                if (name.endsWith('RightUpLeg')) bones.rThigh = child;
                if (name.endsWith('LeftUpLeg')) bones.lThigh = child;
                if (name.endsWith('RightLeg')) bones.rShin = child;
                if (name.endsWith('LeftLeg')) bones.lShin = child;
                if (name.endsWith('Spine')) bones.spine = child;
                if (name.endsWith('Neck')) bones.neck = child;
                if (name.endsWith('Hips')) bones.hips = child;
            }
        });
        this._loggedBones = true;

        if (this.vehicle && this.vehicle.type === 'motorcycle') {
            // Rotalo: Math.PI aligns his back to camera and face to handlebars
            this.mesh.rotation.y = 0;

            // Force position every frame to override any unintended offsets
            const cfg = this.world?.vehicleManager?.settings?.motorcycle;
            if (cfg && cfg.seatOffset) {
                this.mesh.position.copy(cfg.seatOffset);
            }

            if (Math.random() < 0.01) { // Log occasionally to prove it's running
                const worldPos = new THREE.Vector3();
                this.mesh.getWorldPosition(worldPos);
                console.log("🏍️ Rider Local:", this.mesh.position.z.toFixed(2), "World Z:", worldPos.z.toFixed(2));
            }
        }

        const applyRel = (bone, pitch, yaw, roll) => {
            if (!bone) return;
            if (!bone.userData) bone.userData = {};
            // Dynamically capture rest pose to survive Hot Reloads!
            if (!bone.userData.restQuaternion) {
                bone.userData.restQuaternion = bone.quaternion.clone();
            }
            const q = bone.userData.restQuaternion.clone();
            if (pitch) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
            if (yaw) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
            if (roll) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
            bone.quaternion.copy(q);
        };

        // 1. Hands to Model (Handlebars)
        applyRel(bones.rArm, 1.2, 0, 0.05);
        applyRel(bones.lArm, 1.2, 0, 1.2);

        // Bend elbows inward
        applyRel(bones.rForeArm, -1, 1, 0);
        applyRel(bones.lForeArm, -1, -1, 0);

        // 2. Torso Lean (Racing Tuck)
        applyRel(bones.spine, 0.7, 0, 0);

        // 3. Lower Body (Tucked Legs)
        applyRel(bones.rThigh, 1.4, 0, -0.2);
        applyRel(bones.lThigh, 1.4, 0, 0.2);

        // Bend knees back onto footpegs
        applyRel(bones.rShin, -1.7, -0.6, 0);
        applyRel(bones.lShin, -1.7, 0.6, 0);

        // 4. Head Position
        applyRel(bones.neck, -0.4, 0, 0);

        // FORCE MATRIX UPDATES AFTER OVERRIDE
        this.mesh.traverse(child => {
            if (child.isBone) {
                child.updateMatrixWorld(true);
            }
        });
    }

    updateCamera(dt) {
        // FIX: Do not update perspective camera if we are in Full Map mode
        // (World.js handles the Drone Camera in that mode)
        if (this.world && this.world.minimap && this.world.minimap.isFullMap) return;

        let currentYaw = this.yaw;

        // Camera is now free to rotate based on this.yaw

        // Increase viewOrigin height if driving to avoid seat/tank
        const headHeight = this.isDriving ? 1.7 : 1.5;
        const viewOrigin = new THREE.Vector3();
        this.mesh.getWorldPosition(viewOrigin);
        viewOrigin.y += headHeight;

        // Dynamic Camera Distance (Wheel Zoom)
        let distance = this.cameraDistance;

        // Base Spherical Offset
        let offsetX = distance * Math.sin(currentYaw) * Math.cos(this.pitch);
        let offsetY = distance * Math.sin(-this.pitch); // Invert pitch for typical feel
        let offsetZ = distance * Math.cos(currentYaw) * Math.cos(this.pitch);

        // HELICOPTER CAMERA OVERRIDE: Nose Camera (Panoramic Exterior)
        if (this.isDriving && this._vehicle && this._vehicle.type === 'helicopter') {
            // "Vista de Morro": Positioned exactly on the nose glass surface for panoramic view
            // Based on visuals, the tail is at +Z, so the nose is at -Z.
            const noseOffset = new THREE.Vector3(0, 0, -5); // Negative Z is Forward
            noseOffset.applyQuaternion(this.vehicle.mesh.quaternion);

            this.camera.position.copy(this.vehicle.mesh.position).add(noseOffset);

            // Look forward (-Z)
            this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

            // --- EXTREME ZOOM OVERRIDE ---
            this.desiredFOV = THREE.MathUtils.clamp(this.desiredFOV, 5, 75);

            // IMPORTANTE: Ocultamos el mesh para que no aparezca en la vista de morro
            this.mesh.visible = false;
            if (this.weaponManager && this.weaponManager.currentWeaponMesh) {
                this.weaponManager.currentWeaponMesh.visible = false;
            }

            return;
        } else if (this.isDriving && this.vehicle && this.vehicle.type === 'tank') {
            distance = Math.max(distance, 12.0); // Minimum 12m for tanks
            // Re-calculate offsets with the new distance
            offsetX = distance * Math.sin(currentYaw) * Math.cos(this.pitch);
            offsetY = distance * Math.sin(-this.pitch);
            offsetZ = distance * Math.cos(currentYaw) * Math.cos(this.pitch);
        }

        // --- OVER THE SHOULDER OFFSET ---
        // If distance is very small (First Person), we don't offset the shoulder.
        // Otherwise, shift the camera to the Right relative to character's facing direction.
        const rightOffsetMag = (distance < 0.8) ? 0.0 : 0.8; // 0.8m to the right over shoulder
        if (rightOffsetMag > 0) {
            offsetX += rightOffsetMag * Math.sin(currentYaw - Math.PI / 2);
            offsetZ += rightOffsetMag * Math.cos(currentYaw - Math.PI / 2);
        }

        const idealPosition = new THREE.Vector3(
            viewOrigin.x + offsetX,
            viewOrigin.y + offsetY,
            viewOrigin.z + offsetZ
        );

        const camDir = idealPosition.clone().sub(viewOrigin);
        const camDist = camDir.length();
        camDir.normalize();

        this.raycaster.set(viewOrigin, camDir);
        this.raycaster.far = camDist;

        // Handle Character Visibility (First Person Mode OR Holstered weapon)
        const inFirstPerson = (this.cameraDistance < 0.8);
        this.mesh.visible = false; // Hide player momentarily so raycaster ignores body natively

        // Also check collisions against vehicles! (Ignore the one we are driving)
        let allCams = [...this.colliders];
        if (this.isDriving && this.vehicle) {
            this.raycaster.layers.set(0); // Asegúrate de que el heli no esté en una capa que el raycast escuche
            // O más simple: desactivamos la colisión si es vista de morro
            if (this.vehicle.type === 'helicopter') {
                this.raycaster.far = 0;
            }
        } else {
            this.raycaster.far = 5; // Valor normal para caminar
        }
        const camHits = this.raycaster.intersectObjects(allCams, true);

        // Restore visibility unless in First Person OR driving a tank/helicopter
        const shouldBeVisible = !inFirstPerson && !(this.isDriving && this.vehicle && (this.vehicle.type === 'tank' || this.vehicle.type === 'helicopter'));
        this.mesh.visible = shouldBeVisible;

        // Force hide weapons if in first person (so you don't see floating arms clipping)
        if (this.weaponManager && this.weaponManager.currentWeaponMesh) {
            this.weaponManager.currentWeaponMesh.visible = (inFirstPerson || this.weaponManager.isHolstered) ? false : true;
        }

        if (camHits.length > 0) {
            // Camera hit a wall.
            // If the wall forces the camera inside the player (closer than 1.0m), ignore the wall collision
            // and let the camera clip through the wall so the avatar ALWAYS remains visible.
            let safeDist = camHits[0].distance - 0.2;
            if (safeDist < 1.0) {
                safeDist = 1.0; // Force minimum 1.0m distance to prevent backface culling vanishing!
            }
            const finalPos = viewOrigin.clone().add(camDir.multiplyScalar(safeDist));
            if (finalPos.y < 0.2) finalPos.y = 0.2; // Keep camera above floor
            this.camera.position.copy(finalPos);
        } else {
            const finalPos = idealPosition.clone();
            if (finalPos.y < 0.2) finalPos.y = 0.2; // Keep camera above floor
            this.camera.position.copy(finalPos);
        }

        this.raycaster.far = 5; // Reset raycaster default

        // Point the camera strictly at the focus point (lower for tanks)
        const focusPoint = viewOrigin.clone();
        if (this.isDriving && this.vehicle && this.vehicle.type === 'tank') {
            focusPoint.y -= 1.0; // Look slightly lower at the tank body/cannon
        }
        this.camera.lookAt(focusPoint);

        // --- APPLY CAMERA SHAKE ---
        if (this.shakeTimer > 0) {
            const intensity = (this.shakeTimer / this.shakeDuration) * this.shakeIntensity;
            this.camera.position.x += (Math.random() - 0.5) * intensity;
            this.camera.position.y += (Math.random() - 0.5) * intensity;
            this.camera.position.z += (Math.random() - 0.5) * intensity;
            this.shakeTimer -= dt;
        }
    }

    // NETWORKING: Get current state
    getData() {
        return {
            x: this.mesh.position.x,
            y: this.mesh.position.y,
            z: this.mesh.position.z,
            rot: this.yaw,
            state: this.state,
            weaponType: this.weaponManager ? this.weaponManager.currentWeaponType : 'pistol' // SYNC WEAPON
        };
    }

    // RADAR LOGIC
    updateRadar() {
        const radarBlips = document.getElementById('radar-blips');
        if (!radarBlips) return;

        // HUD Elements
        const altReadout = document.querySelector('.alt-readout');
        const altTape = document.getElementById('alt-tape');
        const attitudePitch = document.getElementById('attitude-pitch');
        const compassRing = document.getElementById('radar-compass-ring');

        // Clear old blips
        radarBlips.innerHTML = '';

        const maxRange = 300.0;
        const myPos = new THREE.Vector3();
        this.mesh.getWorldPosition(myPos);
        const vMesh = this.vehicle ? this.vehicle.mesh : null;

        // --- UPDATE HEADING & COMPASS ---
        let headingDeg = THREE.MathUtils.radToDeg(-this.yaw);
        headingDeg = (headingDeg % 360 + 360) % 360;

        if (compassRing) compassRing.style.transform = `rotate(${-headingDeg}deg)`;

        // --- UPDATE ALTIMETER ---
        const altitude = Math.max(0, Math.floor(myPos.y));
        if (altReadout) altReadout.innerText = altitude + 'm';
        if (altTape) altTape.style.transform = `translateY(${altitude % 100}px)`;

        // --- UPDATE ATTITUDE INDICATOR ---
        if (vMesh && attitudePitch) {
            const euler = new THREE.Euler().setFromQuaternion(vMesh.quaternion, 'YXZ');
            const pitchDeg = THREE.MathUtils.radToDeg(euler.x);
            const rollDeg = THREE.MathUtils.radToDeg(euler.z);
            const pitchOffset = pitchDeg * 2.0;
            attitudePitch.style.transform = `rotate(${-rollDeg}deg) translateY(${pitchOffset}px)`;
        }

        const addBlip = (pos, typeClass, iconText) => {
            const dx = pos.x - myPos.x;
            const dz = pos.z - myPos.z;
            const dist2D = Math.sqrt(dx * dx + dz * dz);
            const dist3D = pos.distanceTo(myPos);

            if (dist2D > maxRange) return;

            const localPos = new THREE.Vector3(dx, 0, dz);
            localPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.yaw);

            const px = 50 + (localPos.x / maxRange) * 50;
            const py = 50 + (localPos.z / maxRange) * 50;

            const blip = document.createElement('div');
            blip.className = 'radar-blip ' + typeClass;
            blip.style.left = `${px}%`;
            blip.style.top = `${py}%`;

            blip.innerHTML = `
                <div class="blip-icon">${iconText}</div>
                <div class="blip-dist">${Math.floor(dist3D)}m</div>
            `;
            radarBlips.appendChild(blip);
        };

        // Vehicles
        if (this.world && this.world.vehicleManager) {
            this.world.vehicleManager.vehicles.forEach(v => {
                if (v === this.vehicle || v.isCrushed) return;

                if (v.type === 'tank') {
                    addBlip(v.mesh.position, 'tank', '▅▇'); // Retro tank icon
                } else if (v.type === 'helicopter') {
                    addBlip(v.mesh.position, 'tank', '🚁');
                } else {
                    addBlip(v.mesh.position, 'car', '■');
                }
            });
        }

        // NPC Cars
        if (this.world && this.world.npcManager) {
            this.world.npcManager.cars.forEach(car => {
                if (!car) return;
                // Si el vehículo NPC es un tanque (suele tener mesh names o isArmor en el manager)
                if (this.world.vehicleManager && this.world.vehicleManager.isArmor(car)) {
                    addBlip(car.position, 'tank', '▅▇'); // Tanque rojo
                } else {
                    addBlip(car.position, 'car', '■'); // Auto cian
                }
            });
        }

        // Remote Players
        if (this.world && this.world.remotePlayers) {
            for (let id in this.world.remotePlayers) {
                const rp = this.world.remotePlayers[id];
                if (rp && rp.mesh) {
                    addBlip(rp.mesh.position, 'tank', '웃'); // Player icon
                }
            }
        }
    }
}
