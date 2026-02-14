import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

export class RemotePlayer {
    constructor(scene, assets, id, initialData) {
        this.scene = scene;
        this.assets = assets;
        this.id = id;

        this.mesh = null;
        this.mixer = null;
        this.animations = {};
        this.currentAction = null;
        this.state = 'idle';

        this.init(initialData);
    }

    init(data) {
        // Clone the mesh properly (with SkinnedMesh support)
        const idleAsset = this.assets['idle'];
        if (!idleAsset || !idleAsset.scene) {
            console.error("RemotePlayer: Missing idle asset");
            return;
        }

        this.mesh = SkeletonUtils.clone(idleAsset.scene);

        // Visual Distinction: Tint the mesh (Server Assigned Color)
        const color = data.color || '#39ff14'; // Fallback to green
        this.tintMesh(this.mesh, color);

        // Create Name Tag
        this.createNameTag(data.name);

        this.mesh.position.set(data.x, data.y, data.z);
        this.mesh.rotation.y = data.rot;
        this.state = data.state;

        this.scene.add(this.mesh);

        // Setup Animations
        this.mixer = new THREE.AnimationMixer(this.mesh);

        // Helper to get clip
        const getClip = (name) => {
            const asset = this.assets[name];
            return (asset && asset.animations) ? asset.animations[0] : null;
        };

        this.animations['idle'] = getClip('idle');
        this.animations['walk'] = getClip('walk'); // Fixed from 'walking'
        this.animations['run'] = getClip('run');   // Fixed from 'running'
        this.animations['jump'] = getClip('jump');

        // Start initial animation
        this.playAnimation(this.state);
    }

    tintMesh(mesh, colorHex) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                // Clone material to avoid affecting local player
                child.material = child.material.clone();

                // 1. Set Base Color
                child.material.color.set(colorHex);

                // 2. Add Emissive (Glow) to prevent being pitch black in shadows
                // Use the same color but dimmer
                if (child.material.emissive) {
                    child.material.emissive.set(colorHex);
                    child.material.emissiveIntensity = 0.4; // Valid glow
                }

                // 3. Ensure map is preserved but colored
                // If the texture is white/grayscale, this tints it.
                // If the texture is dark, emissive helps.
            }
        });
    }

    createNameTag(name) {
        // Create Name Tag
        this.nameTag = document.createElement('div');
        this.nameTag.style.position = 'absolute';
        this.nameTag.style.color = 'white';
        this.nameTag.style.background = 'rgba(0, 0, 0, 0.5)';
        this.nameTag.style.padding = '2px 5px';
        this.nameTag.style.borderRadius = '3px';
        this.nameTag.style.fontSize = '12px';
        this.nameTag.style.pointerEvents = 'none'; // Click through
        this.nameTag.style.userSelect = 'none';
        this.nameTag.innerText = name || "Player";
        document.body.appendChild(this.nameTag);
    }

    update(dt, camera) {
        if (this.mixer) this.mixer.update(dt);

        // Update Name Tag Position
        if (this.nameTag && this.mesh && camera) {
            const headPos = this.mesh.position.clone().add(new THREE.Vector3(0, 2.0, 0)); // Above head
            headPos.project(camera);

            const x = (headPos.x * .5 + .5) * window.innerWidth;
            const y = (-(headPos.y * .5) + .5) * window.innerHeight;

            // Simple check if in front of camera
            if (headPos.z < 1) {
                this.nameTag.style.display = 'block';
                this.nameTag.style.left = `${x}px`;
                this.nameTag.style.top = `${y}px`;
                this.nameTag.style.transform = 'translate(-50%, -100%)';
            } else {
                this.nameTag.style.display = 'none';
            }
        }
    }

    updateState(data) {
        // Smoothly interpolate position (Simple Lerp)
        // Ideally we use a buffer, but for now simple Lerp is better than snap
        this.mesh.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.3);

        // Rotation (Shortest path interpolation could be better, but direct set is OK for now)
        // FIX: Add Math.PI because GLB models face +Z (backwards) by default
        this.mesh.rotation.y = data.rot + Math.PI;

        if (this.state !== data.state) {
            this.state = data.state;
            this.playAnimation(this.state);
        }
    }

    playAnimation(name) {
        // Map 'backward' to 'walk' or specific if we had it
        if (name === 'backward') name = 'walk';

        const clip = this.animations[name];
        if (!clip) return;

        if (this.currentAction) {
            this.currentAction.fadeOut(0.2);
        }

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.fadeIn(0.2);
        action.play();

        this.currentAction = action;
    }

    dispose() {
        if (this.nameTag) {
            this.nameTag.remove();
        }

        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.traverse((child) => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (child.material) child.material.dispose();
                }
            });
        }
    }
}
