import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import fs from 'fs';
import { JSDOM } from 'jsdom';

// Mock browser environment for Three.js
const dom = new JSDOM();
global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

async function inspectGLB(path) {
    const loader = new GLTFLoader();
    // DRACO might be needed
    // const dracoLoader = new DRACOLoader();
    // dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
    // loader.setDRACOLoader(dracoLoader);

    const data = fs.readFileSync(path);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

    return new Promise((resolve, reject) => {
        loader.parse(arrayBuffer, '', (gltf) => {
            const scene = gltf.scene;
            const box = new THREE.Box3().setFromObject(scene);
            const size = new THREE.Vector3();
            box.getSize(size);
            const center = new THREE.Vector3();
            box.getCenter(center);
            
            console.log(`Model: ${path}`);
            console.log(`Size: ${size.x.toFixed(3)}, ${size.y.toFixed(3)}, ${size.z.toFixed(3)}`);
            console.log(`Center: ${center.x.toFixed(3)}, ${center.y.toFixed(3)}, ${center.z.toFixed(3)}`);
            
            scene.traverse(c => {
                if (c.isMesh) {
                    console.log(` - Mesh: ${c.name}`);
                }
            });
            resolve();
        }, reject);
    });
}

// path to car2.glb
const path = 'd:/accionCity/public/models/car2.glb';
inspectGLB(path).catch(console.error);
