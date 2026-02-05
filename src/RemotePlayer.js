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
        
        // Visual Distinction: Tint the mesh (Neon Green)
        this.tintMesh(this.mesh, 0x39ff14); 
        
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
        this.animations['walk'] = getClip('walking');
        this.animations['run'] = getClip('running');
        this.animations['jump'] = getClip('jump');
        
        // Start initial animation
        this.playAnimation(this.state);
    }

    tintMesh(mesh, colorHex) {
        mesh.traverse((child) => {
            if (child.isMesh && child.material) {
                // Clone material to avoid affecting local player
                child.material = child.material.clone();
                // Simple tint using emissive or color
                // If texture exists, color multiplies it.
                // Let's try explicit color set + emissive for glow
                child.material.color.setHex(colorHex);
                // child.material.emissive.setHex(0x222244); 
            }
        });
        
        // Add a floating marker (Text) logic could go here later
    }

    update(dt) {
        if (this.mixer) this.mixer.update(dt);
    }

    updateState(data) {
        // Smoothly interpolate position (Simple Lerp)
        // Ideally we use a buffer, but for now simple Lerp is better than snap
        this.mesh.position.lerp(new THREE.Vector3(data.x, data.y, data.z), 0.3);
        
        // Rotation (Shortest path interpolation could be better, but direct set is OK for now)
        this.mesh.rotation.y = data.rot;

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
