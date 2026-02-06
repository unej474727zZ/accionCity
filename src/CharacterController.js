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

        // START POS: Back to (0,0,40) as requested
        // Ensure we start high enough to fall/snap correctly
        this.mesh.position.set(0, 5, 40);
        this.scene.add(this.mesh);

        // 3. Setup Input (Keyboard)
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));

        // Mouse look control setup
        this.yaw = 0;
        this.pitch = 0;

        // Zoom State
        this.isZooming = false;

        document.addEventListener('mousemove', (e) => this.onMouseMove(e));

        // Pointer Lock (Left Click)
        document.addEventListener('click', () => {
            if (!('ontouchstart' in window)) {
                document.body.requestPointerLock();
            }
        });

        // Zoom Input (Right Click)
        document.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // 2 = Right Click
                this.isZooming = true;
            }
        });

        document.addEventListener('mouseup', (e) => {
            if (e.button === 2) {
                this.isZooming = false;
            }
        });

        // Prevent Context Menu on Right Click
        document.addEventListener('contextmenu', e => e.preventDefault());

        // 4. Setup Input (Mobile Joysticks)
        this.initJoysticks();
    }


    initJoysticks() {
        // 1. Buttons (Left Side: Forward/Back)
        const btnFwd = document.getElementById('btn-fwd');
        const btnBack = document.getElementById('btn-back');

        const handleTouch = (btn, key, active) => {
            btn.addEventListener(active ? 'touchstart' : 'touchend', (e) => {
                e.preventDefault();
                this.keys[key] = active;
            });
            // Handle mouse too for testing
            btn.addEventListener(active ? 'mousedown' : 'mouseup', (e) => {
                e.preventDefault();
                this.keys[key] = active;
            });
        };

        handleTouch(btnFwd, 'forward', true);
        handleTouch(btnFwd, 'forward', false);

        handleTouch(btnBack, 'backward', true);
        handleTouch(btnBack, 'backward', false);

        // Zoom Button (Mobile)
        const btnZoom = document.getElementById('btn-zoom');
        if (btnZoom) {
            const handleZoom = (active) => {
                this.isZooming = active;
            };
            btnZoom.addEventListener('touchstart', (e) => { e.preventDefault(); handleZoom(true); });
            btnZoom.addEventListener('touchend', (e) => { e.preventDefault(); handleZoom(false); });
            btnZoom.addEventListener('mousedown', (e) => { e.preventDefault(); handleZoom(true); });
            btnZoom.addEventListener('mouseup', (e) => { e.preventDefault(); handleZoom(false); });
        }

        // 2. Right Joystick: Camera Look (Dynamic joystick)
        const rightZone = document.getElementById('zone_right');
        const managerRight = nipplejs.create({
            zone: rightZone,
            mode: 'dynamic',
            position: { left: '50%', top: '50%' },
            color: 'red',
            size: 100
        });

        managerRight.on('move', (evt, data) => {
            if (data.vector) {
                this.joystickValues.lookX = data.vector.x * 2.5;
                this.joystickValues.lookY = data.vector.y * 2.0;
            }
        });
        managerRight.on('end', () => {
            this.joystickValues.lookX = 0;
            this.joystickValues.lookY = 0;
        });
    }

    getClip(gltf, fallbackName) {
        if (gltf && gltf.animations && gltf.animations.length > 0) {
            return gltf.animations[0];
        }
        return null;
    }

    playAnimation(name, loop = true) {
        if (this.currentAction && this.state === name) return;

        // console.log(`Anim switch: ${this.state} -> ${name}`); // DEBUG

        const clip = this.animations[name];
        if (!clip) return;

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

        // 1. Update Rotation (Joystick + Mouse)
        const joyLookSpeed = 1.5; // Speed multiplier for joystick look
        this.yaw -= this.joystickValues.lookX * joyLookSpeed * dt;
        this.pitch += this.joystickValues.lookY * joyLookSpeed * dt; // Inverted Y typically? Standard is Up=Up.
        // Clamping pitch
        this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch));

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
                if (!this.isJumping) nextState = isRunning ? 'run' : 'walk';

                speed = isRunning ? this.runSpeed : this.walkSpeed;
                // Modulate speed by stick pressure
                speed *= Math.abs(forwardInput);
            } else if (forwardInput < -0.1) { // Moving backward
                if (!this.isJumping) nextState = 'backward';
                speed = -this.walkSpeed * 0.6 * Math.abs(forwardInput);
            } else {
                // pure strafe
                if (!this.isJumping) nextState = 'walk';
                speed = this.walkSpeed * Math.abs(strafeInput); // Just applying speed to movement vector
            }
        } else {
            // NOT MOVING
            if (!this.isJumping) nextState = 'idle';
            speed = 0;
        }

        // 3. Move Character (Always run physics)
        // 3. PHYSICS & GRAVITY

        // RAYCAST FIRST to see what's below us
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

        // 6. Update Camera
        // Calculate Orbit Position: Rotate offset vector by yaw
        const currentOffset = this.cameraOffset.clone();
        currentOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

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
