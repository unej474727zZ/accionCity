import { World } from './src/World.js';

const app = document.getElementById('app');
const world = new World(app);

world.start();

// UI Bindings
const btnNV = document.getElementById('btn-nv');
if (btnNV) {
    btnNV.addEventListener('touchstart', (e) => {
        e.preventDefault();
        world.toggleNightVision();
        btnNV.style.transform = "scale(0.9)";
        setTimeout(() => btnNV.style.transform = "scale(1)", 100);
    });
    btnNV.addEventListener('mousedown', (e) => {
        e.preventDefault();
        world.toggleNightVision();
    });
}

// Keyboard Shortcut (N)
window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN') {
        // Toggle Night Vision (Assuming world has this method exposed/implemented)
        if (world.toggleNightVision) world.toggleNightVision();
    }
});
