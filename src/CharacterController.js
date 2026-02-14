import * as THREE from 'three';
import nipplejs from 'nipplejs';

export class CharacterController {
    constructor(scene, camera, assets) {
        this.scene = scene;
        this.camera = camera;
        this.assets = assets;

        // Debug UI removed per user request

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.state = 'idle'; // idle, walk, run, backward
        this.isJumping = false;

        // Input state
        this.keys = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            spaceHeld: false
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
            this.mesh = idleGLTF.scene;


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
            this.animations['walk'] = this.getClip(this.assets['walk'], 'walk');
            this.animations['run'] = this.getClip(this.assets['run'], 'run');
            this.animations['backward'] = this.getClip(this.assets['backward'], 'backward');
            this.animations['jump'] = this.getClip(this.assets['jump'], 'jump');

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
                    const boneName = track.name.split('.')[0];
                    if (upperBodyBones.some(b => boneName.includes(b))) newTracks.push(track);
                });
                this.animations['pistol_upper'] = new THREE.AnimationClip('pistol_upper', -1, newTracks);
            }

            // Start idle
            this.playAnimation('idle');

        } else {
            // Fallback path: Create Box
            console.warn("Character asset missing, using Fallback Box.");
            const geometry = new THREE.BoxGeometry(0.5, 1.8, 0.5);
            const material = new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true });
            this.mesh = new THREE.Mesh(geometry, material);
            // No animations (mixer stays null)
        }

        // START POS: Check LocalStorage or Default
        const savedPos = JSON.parse(localStorage.getItem('playerPos'));
        if (savedPos) {
            this.mesh.position.set(savedPos.x, savedPos.y, savedPos.z);
            this.yaw = savedPos.yaw || 0;
            console.log("Restored Setup:", savedPos);
        } else {
            this.mesh.position.set(0, 5, 40); // Default
        }

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
        document.addEventListener('click', () => {
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
            if (this.weaponManager) {
                this.weaponManager.isFiring = true;
                this.weaponManager.shoot();
            }
        }, () => {
            if (this.weaponManager) this.weaponManager.isFiring = false;
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
            this.desiredFOV = (this.desiredFOV < 70) ? 75 : 30;
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

        let gpInfo = "No GP";

        // 1. Update Rotation (Joystick + Mouse + Keyboard)
        const joyLookSpeed = 0.75; // REDUCED from 1.5 for smoother mobile control
        this.yaw -= this.joystickValues.lookX * joyLookSpeed * dt;
        this.pitch += this.joystickValues.lookY * joyLookSpeed * dt;

        // KEYBOARD LOOK UPDATE
        const keyLookSpeed = 2.0 * dt;
        if (this.keys.lookLeft) this.yaw += keyLookSpeed;
        if (this.keys.lookRight) this.yaw -= keyLookSpeed;
        if (this.keys.lookUp) this.pitch += keyLookSpeed;
        if (this.keys.lookDown) this.pitch -= keyLookSpeed;

        // Clamping pitch
        this.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.pitch));

        // Fix: Rotate mesh 180 (Math.PI) because GLB faces +Z (towards cam) by default
        // We want it to face -Z (away from cam/forward)
        // Fix: Rotate mesh 180 (Math.PI) because GLB faces +Z (towards cam) by default
        // We want it to face -Z (away from cam/forward)
        this.mesh.rotation.y = this.yaw + Math.PI;

        // HEIGHT FIX REMOVED: Was causing physics conflict (floating/shaking)
        // this.mesh.position.y = 0.95; 


        // 2. Determine State & Speed (Keyboard + Joystick + GAMEPAD)
        let speed = 0;
        let nextState = 'idle';

        if (this.isJumping) {
            nextState = 'jump';
            // Keep moving forward if we were moving, but maybe slower control?
            // For now, allow full control
        }

        // Joystick/Gamepad priority
        let forwardInput = 0; // -1 to 1
        let strafeInput = 0;  // -1 to 1

        // GAMEPAD POLLING
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        let gamepad = null;
        for (let i = 0; i < gamepads.length; i++) {
            if (gamepads[i]) {
                gamepad = gamepads[i];
                break; // uses the first active gamepad
            }
        }

        if (gamepad) {
            gpInfo = gamepad.id;
            // Standard mapping:
            // Axes[0] = Left Stick X (Left/Right)
            // Axes[1] = Left Stick Y (Up/Down)
            // Axes[2] = Right Stick X (Look Left/Right)
            // Axes[3] = Right Stick Y (Look Up/Down)

            // Deadzone
            const deadzone = 0.1;

            // Movement
            if (Math.abs(gamepad.axes[1]) > deadzone) forwardInput -= gamepad.axes[1]; // Y is inverted often
            if (Math.abs(gamepad.axes[0]) > deadzone) strafeInput += gamepad.axes[0];

            // Camera (Add to existing joystick/mouse look)
            // CHECK AXIS 2 (Right Stick X)
            if (Math.abs(gamepad.axes[2]) > deadzone) {
                this.joystickValues.lookX = gamepad.axes[2] * 2.5;
            } else {
                // FIX: Reset to 0 when stick is released!
                this.joystickValues.lookX = 0;
            }

            // CHECK AXIS 3 (Right Stick Y)
            if (Math.abs(gamepad.axes[3]) > deadzone) {
                this.joystickValues.lookY = -gamepad.axes[3] * 2.0; // Inverted: Up is Up
            } else {
                // FIX: Reset to 0 when stick is released!
                this.joystickValues.lookY = 0;
            }

            // Run Button (Usually button 2 'X' or Triggers)
            // Checking B0 (A), B1 (B), B2 (X), B3 (Y)
            // Let's use Button 2 (X on Xbox / Square on PS) or Button 1 (B) for Run
            if (gamepad.buttons[2].pressed || gamepad.buttons[5].pressed) { // X or R1
                this.keys.run = true;
            } else {
                // Only reset if keyboard isn't holding it
                if (!this.keys.isShiftPressed) this.keys.run = false;
            }

            // Jump Button (A / X / Button 0)
            if (gamepad.buttons[0].pressed) {
                if (!this.gamepadJumpHeld) {
                    this.triggerJump('gamepad');
                    this.gamepadJumpHeld = true;
                }
            } else {
                this.gamepadJumpHeld = false;
            }

            // COMBAT CONTROLS
            if (this.weaponManager) {
                // Shoot (Right Trigger / R2 / Button 7)
                if (gamepad.buttons[7] && gamepad.buttons[7].value > 0.1) {
                    this.weaponManager.isFiring = true;
                    if (!this.gamepadTriggerHeld) {
                        // Optional: semi-auto logic or just let weapon manager handle rate
                    }
                    this.gamepadTriggerHeld = true;
                    this.weaponManager.shoot(); // Ensure it calls shoot (auto-fire handled in WM update too?)
                    // Actually WM handles auto-fire if isFiring is true.
                } else {
                    this.weaponManager.isFiring = false;
                    this.gamepadTriggerHeld = false;
                }

                // Switch Weapon (Y / Triangle / Button 3)
                if (gamepad.buttons[3].pressed) {
                    if (!this.gamepadSwitchHeld) {
                        this.weaponManager.cycleWeapon();
                        this.gamepadSwitchHeld = true;
                    }
                } else {
                    this.gamepadSwitchHeld = false;
                }

                // Toggle Laser (B / Circle / Button 1) OR R3 (Button 11)
                // Let's use R3 for Laser (Common for special) or D-Pad Up?
                // User asked for B? No, user just asked to update.
                // Let's use B (Button 1) for now as it's unused.
                if (gamepad.buttons[1].pressed) {
                    if (!this.gamepadLaserHeld) {
                        this.weaponManager.toggleLaser();
                        this.gamepadLaserHeld = true;
                    }
                } else {
                    this.gamepadLaserHeld = false;
                }

                // Zoom (Left Trigger / L2 / Button 6)
                if (gamepad.buttons[6] && gamepad.buttons[6].value > 0.1) {
                    this.desiredFOV = 30; // Zoom In
                } else {
                    this.desiredFOV = 75; // Reset
                }

                // Night Vision (D-Pad Up / Button 12)
                if (gamepad.buttons[12].pressed) {
                    if (!this.gamepadNVHeld) {
                        if (this.world) this.world.toggleNightVision();
                        this.gamepadNVHeld = true;
                    }
                } else {
                    this.gamepadNVHeld = false;
                }

                // Photo Mode / Toggle UI (Select / Back / Button 8)
                if (gamepad.buttons[8] && gamepad.buttons[8].pressed) {
                    if (!this.gamepadUIHeld) {
                        if (this.world) this.world.toggleUI();
                        this.gamepadUIHeld = true;
                    }
                } else {
                    this.gamepadUIHeld = false;
                }
            }
        }

        // Keyboard contrib
        if (this.keys.forward) forwardInput += 1;
        if (this.keys.backward) forwardInput -= 1;
        if (this.keys.left) strafeInput -= 1;
        if (this.keys.right) strafeInput += 1;

        // Joystick contrib (Mobile)
        forwardInput += this.joystickValues.linear;
        strafeInput += this.joystickValues.angular;

        // Clamp
        forwardInput = Math.max(-1, Math.min(1, forwardInput));
        strafeInput = Math.max(-1, Math.min(1, strafeInput));

        // Hard Deadzone (to prevent drift "running in place")
        if (Math.abs(forwardInput) < 0.1) forwardInput = 0;
        if (Math.abs(strafeInput) < 0.1) strafeInput = 0;

        const isMoving = Math.abs(forwardInput) > 0 || Math.abs(strafeInput) > 0;

        if (isMoving) {
            // Run toggle logic? 
            // For now, Joystick full deflection = run? Or dedicated run button?
            // Run logic:
            // EXPLICIT RUN ONLY: Run only if Shift is pressed (User Request)
            // Joystick intensity will only control speed magnitude, but CAP at walk speed unless shift is held.

            let isRunning = false;

            // Keyboard Shift overrides (or enables run for WASD/Joystick)
            if (this.keys.run) {
                isRunning = true;
            }

            if (forwardInput > 0.1) { // Moving forward
                if (!this.isJumping) {
                    // Always use Run/Walk state. 
                    // Firing is handled as a Mask Layer in update() / setFiring()
                    nextState = isRunning ? 'run' : 'walk';
                }
                speed = isRunning ? this.runSpeed : this.walkSpeed;
                // Modulate speed by stick pressure
                speed *= Math.abs(forwardInput);
            } else if (forwardInput < -0.1) { // Moving backward
                if (!this.isJumping) nextState = 'backward';
                // console.log("State: Backward"); // DEBUG
                speed = -this.walkSpeed * 0.6 * Math.abs(forwardInput);
            } else {
                // pure strafe

                // pure strafe
                if (!this.isJumping) {
                    nextState = 'walk'; // Standard strafe + Mask handled by setFiring
                }
                speed = this.walkSpeed * Math.abs(strafeInput); // Just applying speed to movement vector
            }
        } else {
            // NOT MOVING
            if (!this.isJumping) nextState = 'idle';
            speed = 0;
        }

        // 3. Move Character (Always run physics)

        // --- NOCLIP / GHOST MODE ---
        if (this.noclip) {
            // Fly Mode Logic
            const flySpeed = this.runSpeed * 2; // Fast
            const moveVec = new THREE.Vector3(0, 0, 0);

            // Vertical (Space=Up, Shift=Down)
            if (this.keys.spaceHeld || this.keys[' ']) moveVec.y += 1;
            if (this.keys.isShiftPressed || this.keys['shift']) moveVec.y -= 1;

            // Horizontal (Relative to Camera/Mesh Rotation)
            // Forward/Back
            if (forwardInput !== 0) moveVec.z -= forwardInput; // -Z is forward in local space
            // Strafe
            if (strafeInput !== 0) moveVec.x -= strafeInput;

            if (moveVec.length() > 0) {
                // Apply rotation
                moveVec.normalize().multiplyScalar(flySpeed * dt);
                moveVec.applyQuaternion(this.mesh.quaternion);

                // Vertical is absolute world Y, not local Y (so we can fly up/down easily)
                // Actually, let's keep it simple: Camera-relative or World-Absolute?
                // World Absolute for Up/Down is easier to control.
                if (this.keys.spaceHeld) this.mesh.position.y += flySpeed * dt;
                if (this.keys.isShiftPressed) this.mesh.position.y -= flySpeed * dt;

                // Horizontal movement
                const forwardDir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
                const rightDir = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);

                // We need to decouple Y from forward/right to fly straight
                // but for noclip we usually want to look-to-fly.
                // For now, simple WASD plane movement + Space/Shift vertical is best.

                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.mesh.quaternion);
                const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);

                // Remove Y component for horizontal flying if we want "FPS style"
                // but for noclip we usually want to look-to-fly.
                // For now, simple WASD plane movement + Space/Shift vertical is best.

                const moveStep = forward.multiplyScalar(forwardInput * flySpeed * dt)
                    .add(right.multiplyScalar(strafeInput * flySpeed * dt));

                this.mesh.position.add(moveStep);
            }

            return; // SKIP PHYSICS
        }

        // 3. PHYSICS & GRAVITY
        const rayOrigin = this.mesh.position.clone();
        rayOrigin.y += 1.0;
        this.groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
        const intersects = this.groundRaycaster.intersectObjects(this.colliders, true);

        let groundHeight = -99999;
        let foundGround = false;
        let groundObj = "None";

        if (intersects.length > 0) {
            const hit = intersects[0];
            // If we are close to this ground (within reasonable step height)
            // Ray starts at y+1.0. 
            if (hit.distance < 2.5) { // Allow detecting ground up to 1.5m below feet
                groundHeight = hit.point.y;
                foundGround = true;
                groundObj = hit.object.name || (hit.object.geometry ? hit.object.geometry.type : "Unknown");
            }
        }

        // STATE MACHINE: AIR vs GROUND

        // 1. JUMPING (Upward velocity)
        if (this.isJumping) {
            this.velocityY -= this.gravity * dt;
            this.mesh.position.y += this.velocityY * dt;
            this.isGrounded = false;

            // Apex reached/falling?
            if (this.velocityY < 0 && foundGround) {
                // Check if we hit ground
                if (this.mesh.position.y <= groundHeight + 0.2) { // Increased catch range slightly
                    this.mesh.position.y = groundHeight + 0.01; // Tiny offset to prevent Z-fighting
                    this.isJumping = false;
                    this.isGrounded = true;
                    this.velocityY = 0;
                }
            }
        }
        // 2. GROUNDED (Stick to floor)
        else if (this.isGrounded) {
            this.velocityY = 0;

            // IDLE LOCK: If not moving, assume ground is stable (anti-jitter)
            const isIdle = (speed === 0);

            if (foundGround) {
                // Snap if close enough (prevent jitter)
                if (this.mesh.position.y - groundHeight < 0.5) {
                    this.mesh.position.y = groundHeight + 0.01; // Stable offset
                } else {
                    // Walked off ledge
                    this.isGrounded = false;
                }
            } else if (isIdle) {
                // If we didn't find ground, BUT we are idle and were grounded...
                // TRUST we are still grounded. (Maybe raycast missed a tiny crack)
                // Do nothing. Maintain pos.
            } else {
                // No ground detected AND moving -> Walked off ledge
                this.isGrounded = false;
            }
        }
        // 3. FALLING (Airborne but not jumping)
        else {
            this.velocityY -= this.gravity * dt;
            this.mesh.position.y += this.velocityY * dt;

            // Landing check
            if (foundGround && this.mesh.position.y <= groundHeight + 0.2) {
                this.mesh.position.y = groundHeight + 0.01;

                this.isGrounded = true;
                this.velocityY = 0;
            }

            // Safety Floor (Asphalt)
            if (this.mesh.position.y < 0) {
                this.mesh.position.y = 0;
                this.isGrounded = true;
                this.velocityY = 0;
            }
        }



        // 4. HORIZONTAL MOVEMENT & COLLISION
        const forward = new THREE.Vector3(0, 0, -1);
        forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        const right = new THREE.Vector3(1, 0, 0);
        right.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

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
                const wallHits = this.raycaster.intersectObjects(this.colliders, true);
                if (wallHits.length > 0 && wallHits[0].distance < 1.0) { // 1m buffer in front
                    blocked = true;
                    // console.log("Wall blocked: " + wallHits[0].object.name);
                    break; // Stop checking if one hits
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

        // 5. Update Animation
        if (!this.isGrounded) {
            // Loop jump animation while in air
            this.playAnimation('jump', true);
        } else {
            this.playAnimation(nextState);
        }

        // Handle Upper Body Firing Mask Visibility
        // RULES:
        // ALWAYS use mask when firing. We have specific masks for Rifle and Pistol.
        // The 'setFiring' method handles selecting the correct mask clip.

        const useMask = (this.weaponManager && this.weaponManager.isFiring);
        this.setFiring(useMask);

        // 6. Update Camera
        // Calculate Orbit Position: Rotate offset vector by yaw
        const currentOffset = this.cameraOffset.clone();
        currentOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

        // onMouseMove (for debug tracking)
        // We'll capture last movementX in a class property if needed, 
        // but for now let's just show PointerLock status.

        // DEBUG OUTPUT
        const debugEl = document.getElementById('debug-console');
        if (debugEl) {
            let keyStr = "";
            for (let k in this.keys) {
                if (this.keys[k]) keyStr += k + " ";
            }
            const plStatus = (document.pointerLockElement === document.body) ? "ACTIVE" : "OFF";
            // Get lookTouchId from zoneRight closure? 
            // We can't access closure vars easily. 
            // But we can infer from joyLookX if it was touch.

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

        // Ideal Position (Target)
        const idealPosition = this.mesh.position.clone().add(currentOffset);

        // SPRING ARM: Check for wall occlusion
        // Cast ray from Character Head towards Idea Camera Position
        // We use a separate point slightly up to represent 'eyes' or 'head' center
        const viewOrigin = this.mesh.position.clone().add(new THREE.Vector3(0, 1.5, 0));

        const camDir = idealPosition.clone().sub(viewOrigin);
        const camDist = camDir.length();
        camDir.normalize();

        // Reuse raycaster (resetting it)
        this.raycaster.set(viewOrigin, camDir);
        this.raycaster.far = camDist; // Only check up to the camera

        const camHits = this.raycaster.intersectObjects(this.colliders, true);

        if (camHits.length > 0) {
            // Hit wall! Pull camera in.
            // Place camera at hit point, slightly pushed forward (0.2m) to avoid clipping INTO the wall
            this.camera.position.copy(camHits[0].point).add(camDir.multiplyScalar(-0.2));
        } else {
            // No wall, use full distance
            this.camera.position.copy(idealPosition);
        }

        // Reset Raycaster far for next frame movement logic (default 5)
        this.raycaster.far = 5;

        // Look rotation for camera
        // We rotate the camera object itself to match look
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

        // 7. Update Mixer
        if (this.mixer) this.mixer.update(dt);

        // DEBUG: Removed
    }

    // NETWORKING: Get current state
    getData() {
        return {
            x: this.mesh.position.x,
            y: this.mesh.position.y,
            z: this.mesh.position.z,
            rot: this.yaw,
            state: this.state
        };
    }
}
