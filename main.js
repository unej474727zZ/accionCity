window.gameStarted = false;
import { World } from './src/World.js';

const app = document.getElementById('app');
const world = new World(app);

window.startGame = () => {
    window.gameStarted = true;
    // Play intro audio
    window.introAudio = new Audio('sounds/intro.mp3?v=' + Date.now());
    window.introAudio.volume = 0.6;
    window.introAudio.play().catch(e => console.log("Audio play failed", e));
    
    // Unlock Three.js audio context using the user interaction!
    if (world && world.soundManager) {
        world.soundManager.resumeContext();
    }
    
    const startBtn = document.getElementById('start-game-btn');
    const loadingText = document.getElementById('loading-text');
    if (startBtn) startBtn.style.display = 'none';
    if (loadingText) loadingText.style.display = 'block';
    
    // Start the game world (loads assets)
    world.start();
};

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
