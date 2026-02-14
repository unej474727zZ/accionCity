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
        this.vehicle = null;    // Current Vehicle
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
            ads: false
        };
        this.gamepadJumpHeld = false;

        this.walkSpeed = 5;
        this.runSpeed = 15.0; // Increased by another 20%
        this.rotationSpeed = 2; // radians per second

        // Camera settings: First person view - Slightly pulled back for parkour visibility
        this.cameraOffset = new THREE.Vector3(0, 2.0, 3.5); // Higher and further back 

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


        this.init();
    }

    init() {
        // 1. Setup Mesh
        const idleGLTF = this.assets['idle'];

        if (idleGLTF) {
            // Normal path: Load GLTF
            this.mesh = idleGLTF.scene; // Use the scene directly

            // Enable shadows
            this.mesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
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

        } else {
            // Fallback path: Create Box
            console.warn("Character asset missing, using Fallback Box.");
            const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.5);
            const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
            this.mesh = new THREE.Mesh(geometry, material);
            // No animations (mixer stays null)
        }

        // User requested: "Always spawn near each other" - Centered on Origin
        const offsetX = (Math.random() - 0.5) * 1.5;
        const offsetZ = (Math.random() - 0.5) * 1.5;

        this.mesh.position.set(offsetX, 5.0, offsetZ); // Even higher to be absolutely sure we clear the floor/sidewalk initially
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

        // 3. Setup Input (Keyboard)
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse look control setup
        this.yaw = 0;
        this.pitch = 0;

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
        document.addEventListener('wheel', (e) => {
            // e.deltaY > 0 means scroll down (zoom out)
            // e.deltaY < 0 means scroll up (zoom in)
            const step = 5;
            if (e.deltaY < 0) {
                this.desiredFOV -= step; // Zoom In
            } else {
                this.desiredFOV += step; // Zoom Out
            }
            // Clamp between 10 (Super Zoom) and 75 (Normal)
            this.desiredFOV = Math.max(10, Math.min(75, this.desiredFOV));
        }, { passive: false });

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

        // Helper for D-Pad (Simulate Analog Input)
        const dpadState = { up: 0, down: 0, left: 0, right: 0 };
        const updateMove = () => {
            this.joystickValues.linear = dpadState.up - dpadState.down;
            this.joystickValues.angular = dpadState.right - dpadState.left;
        };

        const bindDpad = (id, direction) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            const handler = (active) => {
                dpadState[direction] = active ? 1 : 0;
                updateMove();
            };
            btn.addEventListener('touchstart', (e) => { e.preventDefault(); handler(true); }, { passive: false });
            btn.addEventListener('touchend', (e) => { e.preventDefault(); handler(false); }, { passive: false });
            // Mouse
            btn.addEventListener('mousedown', (e) => { e.preventDefault(); handler(true); });
            btn.addEventListener('mouseup', (e) => { e.preventDefault(); handler(false); });
            // Block click propagation (Fixes PointerLock spin)
            btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        };

        bindDpad('btn-up', 'up');
        bindDpad('btn-down', 'down');
        bindDpad('btn-left', 'left');
        bindDpad('btn-right', 'right');

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
                        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));

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

        // L BUTTON -> NIGHT VISION (Swapped with Select)
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

        // TRIANGLE -> SWITCH WEAPON
        bindBtn('btn-tri', () => {
            if (this.weaponManager) this.weaponManager.cycleWeapon();
        }, null);

        // CIRCLE -> LASER TOGGLE
        bindBtn('btn-cir', () => {
            if (this.weaponManager) this.weaponManager.toggleLaser();
        }, null);

        // X (CROSS) -> JUMP
        bindBtn('btn-x', () => this.triggerJump('touch'), null);

        // SQUARE -> RUN (Sprint)
        bindBtn('btn-sq', () => this.keys.run = true, () => this.keys.run = false);


        // SELECT -> ZOOM (Toggle) (Swapped with L)
        bindBtn('btn-select', () => {
            this.keys.ads = !this.keys.ads;
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


        // --- EXTRA TOGGLES ---

        // CHAT TOGGLE
        bindBtn('btn-chat-toggle', () => {
            const chat = document.getElementById('chat-container');
            if (chat) chat.style.display = (chat.style.display === 'none') ? 'flex' : 'none';
        }, null);

        // MAP TOGGLE (Button) - Same as Start
        bindBtn('btn-map-toggle', () => {
            const minimap = document.getElementById('minimap-canvas');
            if (minimap) minimap.style.display = (minimap.style.display === 'none') ? 'block' : 'none';
        }, null);

        // EXTRA: RIGHT D-PAD (Camera Control) - "Second Cross"
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

        // console.log(`Anim switch: ${this.state} -> ${name}`); // DEBUG

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

        const fadeDuration = (name === 'idle') ? 0.1 : 0.2; // Faster snap to idle

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

    onKeyDown(e) {
        // console.log("Key pressed:", e.code); // DEBUG: Uncomment if inputs are weird
        switch (e.code) {
            case 'KeyW': this.keys.forward = true; break;
            case 'KeyS': this.keys.backward = true; break;
            case 'KeyA': this.keys.left = true; break;
            case 'KeyD': this.keys.right = true; break;
            case 'ShiftLeft':
            case 'ShiftRight':
                this.keys.run = true;
                this.keys.isShiftPressed = true;
                break;
            case 'Space':
                // Keyboard auto-repeats, so we guard against rapid fire
                if (!this.keys.spaceHeld) {
                    this.triggerJump('keyboard');
                    this.keys.spaceHeld = true;
                }
                break;

            // CAMERA LOOK (Arrow Keys Only)
            case 'ArrowUp': this.keys.lookUp = true; break;
            case 'ArrowDown': this.keys.lookDown = true; break;
            case 'ArrowLeft': this.keys.lookLeft = true; break;
            case 'ArrowRight': this.keys.lookRight = true; break;

            case 'KeyF': this.keys.fire = true; break;
            case 'KeyV': this.keys.ads = true; break;
        }
    }

    onKeyUp(e) {
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
            case 'Space':
                this.keys.spaceHeld = false;
                break;

            // CAMERA LOOK (Arrow Keys Only)
            case 'ArrowUp': this.keys.lookUp = false; break;
            case 'ArrowDown': this.keys.lookDown = false; break;
            case 'ArrowLeft': this.keys.lookLeft = false; break;
            case 'ArrowRight': this.keys.lookRight = false; break;

            case 'KeyF': this.keys.fire = false; break;
            case 'KeyV': this.keys.ads = false; break;
        }
    }

    onMouseMove(e) {
        if (document.pointerLockElement === document.body) {
            this.yaw -= e.movementX * 0.002;
            this.pitch -= e.movementY * 0.002;
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));
        }
    }

    update(dt) {
        if (!this.mesh) return;

        // 1. CLEAR PREVIOUS INPUT STATE
        this.inputVector = { x: 0, y: 0 };
        this.isRunning = this.keys.run || this.keys.isShiftPressed;

        // 2. UPDATE LOOK ROTATION (Rotation should always work)
        const joyLookSpeed = 0.75;
        this.yaw -= this.joystickValues.lookX * joyLookSpeed * dt;
        this.pitch += this.joystickValues.lookY * joyLookSpeed * dt;

        const keyLookSpeed = 2.0 * dt;
        if (this.keys.lookLeft) this.yaw += keyLookSpeed;
        if (this.keys.lookRight) this.yaw -= keyLookSpeed;
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
            if (Math.abs(gamepad.axes[1]) > dz) fInput -= gamepad.axes[1];
            if (Math.abs(gamepad.axes[0]) > dz) sInput += gamepad.axes[0];
            if (gamepad.buttons[2].pressed || gamepad.buttons[5].pressed) this.isRunning = true;
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
            // Firing (Character Driven)
            this.weaponManager.isFiring = this.keys.fire;

            // Aiming (ADS)
            this.desiredFOV = this.keys.ads ? 30 : 75;

            // Cycle Weapon (Keyboard 2 or Triangle)
            if (this.keys.weaponCycle || (gamepad && gamepad.buttons[3].pressed)) {
                if (!this._weaponCycleHeld) {
                    this.weaponManager.cycleWeapon();
                    this._weaponCycleHeld = true;
                }
            } else {
                this._weaponCycleHeld = false;
            }

            // Toggle Laser (Keyboard L or Circle)
            if (this.keys.toggleLaser || (gamepad && gamepad.buttons[1].pressed)) {
                if (!this._laserToggleHeld) {
                    this.weaponManager.toggleLaser();
                    this._laserToggleHeld = true;
                }
            } else {
                this._laserToggleHeld = false;
            }

            // ADS FOV
            this.desiredFOV = (this.keys.ads || (gamepad && gamepad.buttons[6] && gamepad.buttons[6].value > 0.1)) ? 30 : 75;

            // Night Vision (Keyboard N or D-Pad Up)
            if (this.keys.nightVision || (gamepad && gamepad.buttons[12].pressed)) {
                if (!this._nvToggleHeld) {
                    if (this.world) this.world.toggleNightVision();
                    this._nvToggleHeld = true;
                }
            } else {
                this._nvToggleHeld = false;
            }

            // UI Toggle (Keyboard P or Select)
            if (this.keys.toggleUI || (gamepad && gamepad.buttons[8].pressed)) {
                if (!this._uiToggleHeld) {
                    if (this.world) this.world.toggleUI();
                    this._uiToggleHeld = true;
                }
            } else {
                this._uiToggleHeld = false;
            }
        }

        // 4. BRANCH LOGIC: DRIVING vs WALKING
        if (this.isDriving) {
            // Update Camera and Mixer
            if (this.mixer) this.mixer.update(dt);
            this.updateCamera(dt);
            this.updateDrivingPose();
            return; // Skip walking physics
        }

        // 5. UPDATE MOVEMENT VECTORS
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        const right = new THREE.Vector3(1, 0, 0);
        right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        // WALKING MODE CONTINUES
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
            if (forwardInput > 0.1) {
                if (!this.isJumping) nextState = isRunning ? 'run' : 'walk';
                speed = isRunning ? this.runSpeed : this.walkSpeed;
                speed *= Math.abs(forwardInput);
            } else if (forwardInput < -0.1) {
                if (!this.isJumping) nextState = 'backward';
                speed = -this.walkSpeed * 0.6 * Math.abs(forwardInput);
            } else {
                if (!this.isJumping) nextState = 'walk';
                speed = this.walkSpeed * Math.abs(strafeInput);
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

        // Add strafe
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
                this.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)), // Center Chest
                this.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)).add(rightAx.multiplyScalar(shoulderWidth)), // Right Shoulder
                this.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)).add(leftAx.multiplyScalar(shoulderWidth))   // Left Shoulder
            ];

            for (const origin of rayOrigins) {
                this.raycaster.set(origin, moveDir);

                // Combine environment colliders and remote player colliders
                const allColliders = [...this.colliders, ...this.remoteColliders];
                const wallHits = this.raycaster.intersectObjects(allColliders, true);

                if (wallHits.length > 0 && wallHits[0].distance < 1.0) { // 1m buffer in front
                    blocked = true;
                    break;
                }
            }

            if (blocked) {
                moveVector.set(0, 0, 0);
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

        // 5. Update Animation / View
        if (this.mixer) this.mixer.update(dt);
        if (this.isDriving) this.updateDrivingPose();
        this.updateCamera(dt);

        if (!this.isDriving) {
            if (!this.isGrounded) {
                // Loop jump animation while in air
                this.playAnimation('jump', true);
            } else {
                this.playAnimation(nextState);
            }
        }

        // Handle Upper Body Firing Mask Visibility
        const useMask = (this.weaponManager && this.weaponManager.isFiring);
        this.setFiring(useMask);

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
        this.vehicle = vehicle;
        if (exitPos) this.mesh.position.copy(exitPos);

        // Hide weapons while driving?
        if (this.weaponManager && this.weaponManager.currentWeaponMesh) {
            this.weaponManager.currentWeaponMesh.visible = !isDriving;
            if (isDriving) this.weaponManager.stopFiring();
        }

        // Toggle Animation
        if (this.mixer) {
            if (isDriving) {
                // Stop ALL other animations (walk, run, etc)
                this.mixer.stopAllAction();

                const drivingClip = this.animations['driving'];
                if (drivingClip) {
                    const action = this.mixer.clipAction(drivingClip);
                    action.reset().fadeIn(0.2).play();
                }
            } else {
                const idleClip = this.animations['idle'];
                if (idleClip) {
                    const action = this.mixer.clipAction(idleClip);
                    action.reset().fadeIn(0.2).play();
                }
            }
        }
    }

    updateDrivingPose() {
        if (!this.isDriving || !this.mesh) return;

        // Procedural Bone Adjustment (IK-ish)
        const bones = {};
        this.mesh.traverse(child => {
            if (child.isBone) {
                const name = child.name;
                // Debug bone names once
                if (!this._loggedBones) {
                    console.log("🦴 Bone Found:", name);
                }

                if (name.includes('RightArm')) bones.rArm = child;
                if (name.includes('LeftArm')) bones.lArm = child;
                if (name.includes('RightForeArm')) bones.rForeArm = child;
                if (name.includes('LeftForeArm')) bones.lForeArm = child;
                if (name.includes('RightUpLeg')) bones.rThigh = child;
                if (name.includes('LeftUpLeg')) bones.lThigh = child;
                if (name.includes('RightLeg')) bones.rShin = child;
                if (name.includes('LeftLeg')) bones.lShin = child;
                if (name.includes('Spine')) bones.spine = child;
                if (name.includes('Neck')) bones.neck = child;
            }
        });
        this._loggedBones = true;

        // 1. Hands to Model (Handlebars - Matching Green Trajectory)
        if (bones.rArm) bones.rArm.rotation.set(-1.5, 0, -5);
        if (bones.lArm) bones.lArm.rotation.set(1.5, 0, 1);
        //if (bones.rArm) bones.rArm.

        // 2. Torso Lean (Extreme Racing Tuck - Matching Pink Trajectory)
        if (bones.spine) bones.spine.rotation.set(0.5, 0, 0);
        //if (bones.spine) bones.spine.

        // 3. Lower Body (Tucked Legs - Matching Red Trajectory)
        if (bones.rThigh) bones.rThigh.rotation.set(1.8, 0.2, 0.3);
        if (bones.lThigh) bones.lThigh.rotation.set(1.8, -0.2, -0.3);

        // Shins: Flex back hard towards the pedals
        if (bones.rShin) bones.rShin.rotation.set(-1.8, 0, 3.22);
        if (bones.lShin) bones.lShin.rotation.set(-1.8, 0, 3.22);

        // 4. Head Position
        if (bones.neck) bones.neck.rotation.set(0, 0, 0); // Looking forward at road
    }

    updateCamera(dt) {
        const currentOffset = this.cameraOffset.clone();
        currentOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        const idealPosition = this.mesh.position.clone().add(currentOffset);

        // Increase viewOrigin height if driving to avoid seat/tank
        const headHeight = this.isDriving ? 1.7 : 1.5;
        const viewOrigin = this.mesh.position.clone().add(new THREE.Vector3(0, headHeight, 0));

        const camDir = idealPosition.clone().sub(viewOrigin);
        const camDist = camDir.length();
        camDir.normalize();

        this.raycaster.set(viewOrigin, camDir);
        this.raycaster.far = camDist;
        const camHits = this.raycaster.intersectObjects(this.colliders, true);

        if (camHits.length > 0 && camHits[0].distance > 0.5) { // 0.5m minimum buffer
            this.camera.position.copy(camHits[0].point).add(camDir.multiplyScalar(-0.2));
        } else {
            this.camera.position.copy(idealPosition);
        }

        this.raycaster.far = 5;
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
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
}
