import * as THREE from 'three';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Seeded PRNG using the Mulberry32 algorithm
 */
export function createPRNG(seed = 1337) {
    let s = (typeof seed === 'number' ? seed : 42) >>> 0;
    return function() {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class ModularCity {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.assets = options.assets || {};
        this.seed = options.seed !== undefined ? options.seed : 1337;
        this.rand = createPRNG(this.seed);
        this.center = options.center || new THREE.Vector3(0, 0, 220); // Placed in the distance shrouded in fog
        this.citySize = 160; // 160x160m walled perimeter
        this.wallHeight = 26; // Impassable by foot or cars

        this.group = new THREE.Group();
        this.group.name = "ModularCity_SectorZero";
        this.colliders = [];
        this.cityBlocks = [];
        this.beaconLights = [];

        // Materials cache
        this.materials = {};
        this.initMaterials();
    }

    /* -------------------------------------------------------------
     * TEXTURE GENERATION (Procedural Canvas Textures)
     * ------------------------------------------------------------- */
    initMaterials() {
        // 1. Asphalt Road Texture with street lines & crosswalk
        const roadTex = this.createRoadTexture();
        this.materials.road = new THREE.MeshLambertMaterial({
            map: roadTex,
            roughness: 0.8
        });

        // 2. Concrete Sidewalk & Curb
        const sidewalkTex = this.createSidewalkTexture();
        this.materials.sidewalk = new THREE.MeshLambertMaterial({
            map: sidewalkTex,
            roughness: 0.9
        });

        // 3. Facade A: Commercial Brick & Glass Storefronts
        const facadeTexA = this.createBrickCommercialTexture();
        this.materials.facadeA = new THREE.MeshLambertMaterial({
            map: facadeTexA
        });

        // 4. Facade B: Urban Concrete Residential with illuminated windows
        const facadeTexB = this.createResidentialConcreteTexture();
        this.materials.facadeB = new THREE.MeshLambertMaterial({
            map: facadeTexB
        });

        // 5. Facade C: Industrial Corrugated Metal & Garage Shutter
        const facadeTexC = this.createIndustrialMetalTexture();
        this.materials.facadeC = new THREE.MeshLambertMaterial({
            map: facadeTexC
        });

        // 6. Perimeter Fortress Wall (Armored Concrete & Warning stripes)
        const wallTex = this.createFortressWallTexture();
        this.materials.wall = new THREE.MeshLambertMaterial({
            map: wallTex
        });

        // 7. Dark Trim / Roof Gravel / Metal
        this.materials.roof = new THREE.MeshLambertMaterial({ color: 0x22262c });
        this.materials.metal = new THREE.MeshLambertMaterial({ color: 0x3a404a });
        this.materials.neonTrim = new THREE.MeshBasicMaterial({ color: 0x00ffff });
        this.materials.warningTrim = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
    }

    createRoadTexture() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');

        // Asphalt Base
        ctx.fillStyle = '#1c2024';
        ctx.fillRect(0, 0, 512, 512);

        // Asphalt noise & grain
        for (let i = 0; i < 25000; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? '#2b3138' : '#14171a';
            ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
        }

        // Center double yellow lines
        ctx.strokeStyle = '#e6a100';
        ctx.lineWidth = 6;
        ctx.setLineDash([0]);
        ctx.beginPath();
        ctx.moveTo(250, 0); ctx.lineTo(250, 512);
        ctx.moveTo(262, 0); ctx.lineTo(262, 512);
        ctx.stroke();

        // White dash lane boundaries
        ctx.strokeStyle = '#c8d4e0';
        ctx.lineWidth = 4;
        ctx.setLineDash([28, 20]);
        ctx.beginPath();
        ctx.moveTo(128, 0); ctx.lineTo(128, 512);
        ctx.moveTo(384, 0); ctx.lineTo(384, 512);
        ctx.stroke();

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(6, 6);
        return tex;
    }

    createSidewalkTexture() {
        const c = document.createElement('canvas');
        c.width = 256;
        c.height = 256;
        const ctx = c.getContext('2d');

        ctx.fillStyle = '#68727d';
        ctx.fillRect(0, 0, 256, 256);

        // Pavement slab lines
        ctx.strokeStyle = '#475059';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 256; i += 64) {
            ctx.beginPath();
            ctx.moveTo(0, i); ctx.lineTo(256, i);
            ctx.moveTo(i, 0); ctx.lineTo(i, 256);
            ctx.stroke();
        }

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 4);
        return tex;
    }

    createBrickCommercialTexture() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');

        // Dark red brick base
        ctx.fillStyle = '#4a2522';
        ctx.fillRect(0, 0, 512, 512);

        // Brick patterns
        ctx.strokeStyle = '#2d1816';
        ctx.lineWidth = 2;
        for (let y = 0; y < 512; y += 16) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(512, y);
            ctx.stroke();
            const offset = (y % 32 === 0) ? 0 : 16;
            for (let x = offset; x < 512; x += 32) {
                ctx.beginPath();
                ctx.moveTo(x, y); ctx.lineTo(x, y + 16);
                ctx.stroke();
            }
        }

        // Ground Floor Glass Storefront (Large illuminated shop windows)
        ctx.fillStyle = '#0f171d';
        ctx.fillRect(20, 360, 472, 140);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 5;
        ctx.strokeRect(25, 365, 462, 130);

        // Store interior glow
        ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.fillRect(30, 370, 452, 120);

        // Upper windows (Rows of illuminated & dark windows)
        for (let row = 0; row < 2; row++) {
            const wy = 50 + row * 150;
            for (let col = 0; col < 4; col++) {
                const wx = 40 + col * 120;
                ctx.fillStyle = '#11161d';
                ctx.fillRect(wx, wy, 70, 90);
                ctx.strokeStyle = '#384452';
                ctx.lineWidth = 4;
                ctx.strokeRect(wx, wy, 70, 90);

                // Warm interior lamp
                if ((row + col) % 2 === 0) {
                    ctx.fillStyle = 'rgba(255, 215, 120, 0.75)';
                    ctx.fillRect(wx + 6, wy + 6, 58, 78);
                }
            }
        }

        const tex = new THREE.CanvasTexture(c);
        return tex;
    }

    createResidentialConcreteTexture() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');

        // Grey concrete paneling
        ctx.fillStyle = '#424a52';
        ctx.fillRect(0, 0, 512, 512);

        // Panel seams
        ctx.strokeStyle = '#2b3137';
        ctx.lineWidth = 3;
        for (let y = 0; y < 512; y += 128) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(512, y);
            ctx.stroke();
        }
        for (let x = 0; x < 512; x += 128) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, 512);
            ctx.stroke();
        }

        // Residential Windows (3 rows, 4 columns)
        for (let r = 0; r < 3; r++) {
            const wy = 30 + r * 155;
            for (let cidx = 0; cidx < 4; cidx++) {
                const wx = 35 + cidx * 120;
                ctx.fillStyle = '#1c2229';
                ctx.fillRect(wx, wy, 65, 85);
                ctx.strokeStyle = '#5a6572';
                ctx.lineWidth = 3;
                ctx.strokeRect(wx, wy, 65, 85);

                // Cyan / Warm lit windows
                if ((r * 4 + cidx) % 3 === 1) {
                    ctx.fillStyle = 'rgba(100, 220, 255, 0.8)';
                    ctx.fillRect(wx + 5, wy + 5, 55, 75);
                } else if ((r * 4 + cidx) % 3 === 2) {
                    ctx.fillStyle = 'rgba(255, 190, 80, 0.7)';
                    ctx.fillRect(wx + 5, wy + 5, 55, 75);
                }
            }
        }

        return new THREE.CanvasTexture(c);
    }

    createIndustrialMetalTexture() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');

        // Corrugated Dark Slate Metal
        ctx.fillStyle = '#2f353d';
        ctx.fillRect(0, 0, 512, 512);

        // Corrugation stripes
        ctx.strokeStyle = '#1e2227';
        ctx.lineWidth = 4;
        for (let x = 0; x < 512; x += 12) {
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x, 512);
            ctx.stroke();
        }

        // Huge Industrial Roller Shutter Gate at the bottom
        ctx.fillStyle = '#1a1d22';
        ctx.fillRect(40, 280, 432, 232);
        ctx.strokeStyle = '#ffae00';
        ctx.lineWidth = 5;
        ctx.strokeRect(40, 280, 432, 232);

        // Roller horizontal slats
        ctx.strokeStyle = '#2a3038';
        ctx.lineWidth = 3;
        for (let y = 290; y < 512; y += 14) {
            ctx.beginPath();
            ctx.moveTo(45, y); ctx.lineTo(467, y);
            ctx.stroke();
        }

        // Hazard stripes top banner
        for (let x = 40; x < 472; x += 30) {
            ctx.fillStyle = '#ffb300';
            ctx.beginPath();
            ctx.moveTo(x, 260); ctx.lineTo(x + 15, 260);
            ctx.lineTo(x, 280); ctx.lineTo(x - 15, 280);
            ctx.fill();
        }

        return new THREE.CanvasTexture(c);
    }

    createFortressWallTexture() {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');

        // Heavy reinforced military concrete
        ctx.fillStyle = '#202428';
        ctx.fillRect(0, 0, 512, 512);

        // Huge block seams
        ctx.strokeStyle = '#121517';
        ctx.lineWidth = 6;
        for (let y = 0; y < 512; y += 128) {
            ctx.beginPath();
            ctx.moveTo(0, y); ctx.lineTo(512, y);
            ctx.stroke();
        }

        // Top hazard warning line
        for (let x = 0; x < 512; x += 40) {
            ctx.fillStyle = '#ff2a2a';
            ctx.beginPath();
            ctx.moveTo(x, 0); ctx.lineTo(x + 20, 0);
            ctx.lineTo(x - 20, 40); ctx.lineTo(x - 40, 40);
            ctx.fill();
        }

        // Stencil "RESTRICTED AIRSPACE"
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 24px monospace';
        ctx.fillText('SECTOR ZERO // AIR ACCESS ONLY', 40, 100);

        const tex = new THREE.CanvasTexture(c);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(4, 2);
        return tex;
    }

    /* -------------------------------------------------------------
     * BILLBOARD & NEON POSTER TEXTURES
     * ------------------------------------------------------------- */
    createBillboardTexture(typeIndex) {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 256;
        const ctx = c.getContext('2d');

        const billboards = [
            { title: 'ACCION CITY', sub: 'SECTOR CERO // 24H', bg: '#0b0e14', border: '#00f0ff', glow: '#ff0055' },
            { title: 'CYBER DINER', sub: 'COCKTAILS & SYNTH NOODLES', bg: '#140c14', border: '#ff00aa', glow: '#ffaa00' },
            { title: 'TURBO CHOP SHOP', sub: 'MODS, ARMOR & NITRO', bg: '#141208', border: '#ffaa00', glow: '#ff3300' },
            { title: 'METRO APARTMENTS', sub: 'HIGH SEC RESIDENCES', bg: '#081214', border: '#00ffaa', glow: '#00aaff' },
            { title: 'QUANTUM ENERGY', sub: 'OVERCLOCK YOUR SYSTEM', bg: '#0a0818', border: '#aa00ff', glow: '#00ffff' },
            { title: 'WANTED: CYBER BOTS', sub: 'BOUNTY: $50,000 CREDITS', bg: '#180808', border: '#ff3333', glow: '#ff8800' }
        ];

        const cfg = billboards[typeIndex % billboards.length];

        ctx.fillStyle = cfg.bg;
        ctx.fillRect(0, 0, 512, 256);

        // Neon Glow Frame
        ctx.strokeStyle = cfg.border;
        ctx.lineWidth = 10;
        ctx.strokeRect(10, 10, 492, 236);

        ctx.strokeStyle = cfg.glow;
        ctx.lineWidth = 4;
        ctx.strokeRect(20, 20, 472, 216);

        // Typography
        ctx.textAlign = 'center';
        ctx.font = '900 42px "Arial Black", sans-serif';
        ctx.fillStyle = cfg.border;
        ctx.shadowColor = cfg.border;
        ctx.shadowBlur = 15;
        ctx.fillText(cfg.title, 256, 115);

        ctx.font = 'bold 20px "Courier New", monospace';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = cfg.glow;
        ctx.shadowBlur = 8;
        ctx.fillText(cfg.sub, 256, 175);

        return new THREE.CanvasTexture(c);
    }

    /* -------------------------------------------------------------
     * GRAFFITI FLOOR DECAL TEXTURES
     * ------------------------------------------------------------- */
    createGraffitiTexture(typeIndex) {
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        const ctx = c.getContext('2d');
        ctx.clearRect(0, 0, 512, 512);

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (typeIndex === 0) {
            // Wildstyle "ACCION CITY" Tag
            ctx.save();
            ctx.translate(256, 256);
            ctx.rotate(-0.08);

            // Spray shadow/splatter
            ctx.font = '900 68px "Arial Black", sans-serif';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
            ctx.fillText('ACCION', 6, 6 - 30);
            ctx.fillText('CITY', 6, 6 + 40);

            // Vibrant multi-color spray
            const grad = ctx.createLinearGradient(-150, -60, 150, 60);
            grad.addColorStop(0, '#ff0077');
            grad.addColorStop(0.5, '#00ffff');
            grad.addColorStop(1, '#ffdd00');
            ctx.fillStyle = grad;
            ctx.fillText('ACCION', 0, -30);
            ctx.fillText('CITY', 0, 40);

            // Splatter dots
            ctx.fillStyle = '#ff0077';
            for (let i = 0; i < 30; i++) {
                ctx.beginPath();
                ctx.arc((Math.random() - 0.5) * 400, (Math.random() - 0.5) * 200, Math.random() * 6 + 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        } else if (typeIndex === 1) {
            // Cyber Skull & "NO SURRENDER"
            ctx.save();
            ctx.translate(256, 256);

            // Skull Stencil
            ctx.fillStyle = '#00f0ff';
            ctx.beginPath();
            ctx.arc(0, -20, 80, 0, Math.PI * 2);
            ctx.fill();

            // Jaw
            ctx.fillRect(-45, 40, 90, 50);

            // Eye holes
            ctx.fillStyle = '#000000';
            ctx.beginPath();
            ctx.arc(-30, -15, 25, 0, Math.PI * 2);
            ctx.arc(30, -15, 25, 0, Math.PI * 2);
            ctx.fill();

            // Text
            ctx.font = 'bold 36px "Arial Black", sans-serif';
            ctx.fillStyle = '#ff0055';
            ctx.fillText('NO SURRENDER', 0, 140);
            ctx.restore();
        } else if (typeIndex === 2) {
            // Drift Zone / Racing Chevrons
            ctx.save();
            ctx.translate(256, 256);
            ctx.rotate(0.12);

            // Tire skid marks
            ctx.strokeStyle = 'rgba(10, 12, 15, 0.85)';
            ctx.lineWidth = 26;
            ctx.beginPath();
            ctx.moveTo(-220, -70); ctx.bezierCurveTo(-100, -90, 80, -30, 220, -50);
            ctx.moveTo(-220, 70); ctx.bezierCurveTo(-100, 50, 80, 110, 220, 90);
            ctx.stroke();

            // DRIFT ZONE Stencil
            ctx.font = '900 52px "Arial Black", sans-serif';
            ctx.fillStyle = '#ffaa00';
            ctx.fillText('⚡ DRIFT ZONE ⚡', 0, 0);

            ctx.font = 'bold 22px monospace';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('AIRSPACE LZ // 60 FPS', 0, 45);
            ctx.restore();
        } else {
            // Hazard "DANGER // RESTRICTED"
            ctx.save();
            ctx.translate(256, 256);

            ctx.strokeStyle = '#ff3333';
            ctx.lineWidth = 14;
            ctx.strokeRect(-180, -90, 360, 180);

            ctx.font = '900 48px monospace';
            ctx.fillStyle = '#ff3333';
            ctx.fillText('⚠ DANGER ⚠', 0, -20);

            ctx.font = 'bold 22px monospace';
            ctx.fillStyle = '#ffffff';
            ctx.fillText('AIR ACCESS ONLY', 0, 40);
            ctx.restore();
        }

        return new THREE.CanvasTexture(c);
    }

    /* -------------------------------------------------------------
     * HOUSE 1: COMMERCIAL / CYBER DINER (Style A)
     * ------------------------------------------------------------- */
    /* -------------------------------------------------------------
     * HOUSE 1: COMMERCIAL / URBAN BUILDING (Style A)
     * ------------------------------------------------------------- */
    createHouseA(billboardIndex) {
        const root = new THREE.Group();
        let width = 16, height = 25, depth = 13;

        if (this.assets && this.assets['house_commercial'] && this.assets['house_commercial'].scene) {
            const model = SkeletonUtils.clone(this.assets['house_commercial'].scene);
            const bbox = new THREE.Box3().setFromObject(model);
            const center = bbox.getCenter(new THREE.Vector3());

            model.position.x -= center.x;
            model.position.y -= bbox.min.y;
            model.position.z -= center.z;

            width = bbox.max.x - bbox.min.x;
            height = bbox.max.y - bbox.min.y;
            depth = bbox.max.z - bbox.min.z;

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            root.add(model);
        } else {
            // Procedural fallback
            const bodyGeom = new THREE.BoxGeometry(22, 10, 20);
            const body = new THREE.Mesh(bodyGeom, this.materials.facadeA);
            body.position.y = 5;
            root.add(body);
            width = 22; height = 10; depth = 20;
        }

        // Rooftop Billboard (Mounted on metal trusses)
        const bbTex = this.createBillboardTexture(billboardIndex);
        const bbMat = new THREE.MeshBasicMaterial({ map: bbTex, side: THREE.DoubleSide });
        const bbGeom = new THREE.PlaneGeometry(12, 6);
        const billboard = new THREE.Mesh(bbGeom, bbMat);
        billboard.position.set(0, height + 3.2, 0);
        root.add(billboard);

        // Rooftop Aeronautical Beacon Light (Pierces fog & snow)
        const beacon = this.createBeaconLight(new THREE.Vector3(0, height + 6.2, 0), 0x00f0ff);
        root.add(beacon);

        root.userData = { width, depth, height, style: 'Commercial' };
        return root;
    }

    /* -------------------------------------------------------------
     * HOUSE 2: SOVIET PANEL BRUTALIST RESIDENTIAL (Style B)
     * ------------------------------------------------------------- */
    createHouseB(billboardIndex) {
        const root = new THREE.Group();
        let width = 38, height = 24, depth = 22;

        if (this.assets && this.assets['house_residential'] && this.assets['house_residential'].scene) {
            const model = SkeletonUtils.clone(this.assets['house_residential'].scene);
            const scaleVal = 38.0; // Scaled to authentic 8-story brutalist panel block
            model.scale.set(scaleVal, scaleVal, scaleVal);

            const bbox = new THREE.Box3().setFromObject(model);
            const center = bbox.getCenter(new THREE.Vector3());

            model.position.x -= center.x;
            model.position.y -= bbox.min.y;
            model.position.z -= center.z;

            width = bbox.max.x - bbox.min.x;
            height = bbox.max.y - bbox.min.y;
            depth = bbox.max.z - bbox.min.z;

            model.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            root.add(model);
        } else {
            // Procedural fallback
            const bodyGeom = new THREE.BoxGeometry(18, 15, 22);
            const body = new THREE.Mesh(bodyGeom, this.materials.facadeB);
            body.position.y = 7.5;
            root.add(body);
            width = 18; height = 15; depth = 22;
        }

        // Vertical Wall Billboard Banner on facade
        const bbTex = this.createBillboardTexture(billboardIndex);
        const bbMat = new THREE.MeshBasicMaterial({ map: bbTex });
        const bb = new THREE.Mesh(new THREE.PlaneGeometry(8, 12), bbMat);
        bb.position.set(width / 2 + 0.15, height / 2, 0);
        bb.rotation.y = Math.PI / 2;
        root.add(bb);

        // Pulsing Red Warning Beacon on rooftop (Distant snow light)
        const beacon = this.createBeaconLight(new THREE.Vector3(0, height + 1.5, 0), 0xff2222);
        root.add(beacon);

        root.userData = { width, depth, height, style: 'Soviet' };
        return root;
    }

    /* -------------------------------------------------------------
     * HOUSE 3: ABANDONED INDUSTRIAL GARAGE / CHOP SHOP (Style C)
     * ------------------------------------------------------------- */
    createHouseC(billboardIndex) {
        const root = new THREE.Group();
        let width = 18, height = 9.5, depth = 16;

        if (this.assets && this.assets['house_garage'] && this.assets['house_garage'].scene) {
            const model = SkeletonUtils.clone(this.assets['house_garage'].scene);
            const scaleVal = 11.5; // Scaled to authentic industrial workshop proportions
            model.scale.set(scaleVal, scaleVal, scaleVal);

            const bbox = new THREE.Box3().setFromObject(model);
            const center = bbox.getCenter(new THREE.Vector3());

            model.position.x -= center.x;
            model.position.y -= bbox.min.y;
            model.position.z -= center.z;

            width = bbox.max.x - bbox.min.x;
            height = bbox.max.y - bbox.min.y;
            depth = bbox.max.z - bbox.min.z;

            // --- APPLIED COLOR ENHANCEMENT (Per User Request) ---
            // "ponle alguito d color a an_abandoned_garage.glb algoq vaya con su nombre no hay q exagerar es para q no c vea palido"
            model.traverse(child => {
                if (child.isMesh && child.material) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(mat => {
                        const m = mat.clone();
                        child.material = m;

                        if (m.color) {
                            // Warm weathered terracotta & rust tone: removes pale washed-out look
                            m.color.setRGB(0.96, 0.84, 0.72);
                        }
                        if (m.emissive) {
                            m.emissive.setHex(0x181008); // Subtle warm rustic undertone
                        }
                        if (m.roughness !== undefined) {
                            m.roughness = Math.max(0.65, m.roughness);
                        }
                        if (m.metalness !== undefined) {
                            m.metalness = Math.min(0.35, m.metalness);
                        }
                        m.needsUpdate = true;
                    });
                }
            });

            root.add(model);
        } else {
            // Procedural fallback
            const bodyGeom = new THREE.BoxGeometry(24, 8.5, 16);
            const body = new THREE.Mesh(bodyGeom, this.materials.facadeC);
            body.position.y = 4.25;
            root.add(body);
            width = 24; height = 8.5; depth = 16;
        }

        // Over-gate Chop Shop Horizontal Billboard
        const bbTex = this.createBillboardTexture(billboardIndex);
        const bb = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.2), new THREE.MeshBasicMaterial({ map: bbTex }));
        bb.position.set(0, height - 1.2, depth / 2 + 0.2);
        root.add(bb);

        // Blinking Amber Antenna Tip Light (Pierces through snow)
        const beacon = this.createBeaconLight(new THREE.Vector3(width / 2 - 2, height + 2.5, depth / 2 - 2), 0xffaa00);
        root.add(beacon);

        root.userData = { width, depth, height, style: 'Garage' };
        return root;
    }

    /* -------------------------------------------------------------
     * DISTANT BEACON LIGHT SPRITE (Cuts through thick fog & snow)
     * ------------------------------------------------------------- */
    createBeaconLight(localPos, colorHex = 0xff0044) {
        const beaconGroup = new THREE.Group();
        beaconGroup.position.copy(localPos);

        // Small emissive core sphere
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), coreMat);
        beaconGroup.add(core);

        // Pulsing glow sprite that pierces through distance
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        const color = new THREE.Color(colorHex);
        grad.addColorStop(0, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 1.0)`);
        grad.addColorStop(0.3, `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, 0.6)`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);

        const spriteMat = new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(6, 6, 1);
        beaconGroup.add(sprite);

        // Keep reference for subtle pulsing animation in update()
        this.beaconLights.push({
            core,
            sprite,
            baseScale: 6,
            phase: this.rand() * Math.PI * 2,
            speed: 2.0 + this.rand() * 2.0
        });

        return beaconGroup;
    }

    /* -------------------------------------------------------------
     * HELIPAD (Landing Target for Air Access)
     * ------------------------------------------------------------- */
    createHelipad(x, y, z) {
        const c = document.createElement('canvas');
        c.width = 256; c.height = 256;
        const ctx = c.getContext('2d');

        // Dark grey pad
        ctx.fillStyle = '#181c20';
        ctx.fillRect(0, 0, 256, 256);

        // Yellow perimeter circle & hazard border
        ctx.strokeStyle = '#ffae00';
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(128, 128, 110, 0, Math.PI * 2);
        ctx.stroke();

        // White Bold 'H'
        ctx.font = '900 130px "Arial Black", sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('H', 128, 128);

        const tex = new THREE.CanvasTexture(c);
        const padGeom = new THREE.PlaneGeometry(16, 16);
        const padMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
        const pad = new THREE.Mesh(padGeom, padMat);
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(x, y + 0.05, z);
        this.group.add(pad);

        // 4 Green Runway Corner Lights
        const offsets = [-7, 7];
        offsets.forEach(dx => {
            offsets.forEach(dz => {
                const b = this.createBeaconLight(new THREE.Vector3(x + dx, y + 0.5, z + dz), 0x00ff88);
                this.group.add(b);
            });
        });

        this.helipadPos = new THREE.Vector3(x, y, z);
    }

    /* -------------------------------------------------------------
     * PERIMETER FORTRESS WALL (Air Access Only Enclosure)
     * ------------------------------------------------------------- */
    buildPerimeterWall() {
        const halfSize = this.citySize / 2;
        const thickness = 5.0;
        const wallH = this.wallHeight;

        const wallConfigs = [
            // North wall
            { pos: [0, wallH / 2, -halfSize], size: [this.citySize + thickness, wallH, thickness] },
            // South wall
            { pos: [0, wallH / 2, halfSize], size: [this.citySize + thickness, wallH, thickness] },
            // West wall
            { pos: [-halfSize, wallH / 2, 0], size: [thickness, wallH, this.citySize] },
            // East wall
            { pos: [halfSize, wallH / 2, 0], size: [thickness, wallH, this.citySize] }
        ];

        wallConfigs.forEach(cfg => {
            const geom = new THREE.BoxGeometry(...cfg.size);
            const wall = new THREE.Mesh(geom, this.materials.wall);
            wall.position.set(...cfg.pos);
            wall.castShadow = true;
            wall.receiveShadow = true;
            this.group.add(wall);
            this.colliders.push(wall);

            // Register wall in cityBlocks
            const bbox = new THREE.Box3().setFromObject(wall);
            this.cityBlocks.push({
                minX: bbox.min.x, maxX: bbox.max.x,
                minY: bbox.min.y, maxY: bbox.max.y,
                minZ: bbox.min.z, maxZ: bbox.max.z,
                height: wallH,
                centerX: cfg.pos[0] + this.center.x,
                centerZ: cfg.pos[2] + this.center.z
            });
        });

        // 4 Corner Watchtowers with Beacons
        const cornerCoords = [
            [-halfSize, -halfSize], [halfSize, -halfSize],
            [-halfSize, halfSize], [halfSize, halfSize]
        ];

        cornerCoords.forEach(([cx, cz]) => {
            const tower = new THREE.Mesh(new THREE.BoxGeometry(7, wallH + 4, 7), this.materials.wall);
            tower.position.set(cx, (wallH + 4) / 2, cz);
            this.group.add(tower);
            this.colliders.push(tower);

            // Beacon on top of tower
            const b = this.createBeaconLight(new THREE.Vector3(cx, wallH + 4.5, cz), 0xff0044);
            this.group.add(b);
        });
    }

    /* -------------------------------------------------------------
     * MAIN BUILD METHOD
     * ------------------------------------------------------------- */
    build() {
        console.log(`[ModularCity] Generating Sector Zero with Procedural Seed: ${this.seed}`);

        // Set group center position
        this.group.position.copy(this.center);

        // 1. Asphalt Ground Plane
        const groundGeom = new THREE.PlaneGeometry(this.citySize, this.citySize);
        const ground = new THREE.Mesh(groundGeom, this.materials.road);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0.02;
        ground.receiveShadow = true;
        this.group.add(ground);

        // 2. Build Inaccessible Perimeter Walls (Air access only!)
        this.buildPerimeterWall();

        // 3. Grid Setup: 3x3 layout (9 blocks)
        // Spacing: cell offsets [-45, 0, 45]
        const cellOffsets = [-45, 0, 45];
        const gridPositions = [];
        cellOffsets.forEach(x => {
            cellOffsets.forEach(z => {
                gridPositions.push({ x, z });
            });
        });

        // 4. House types list: EXACTLY 3 House A, 3 House B, 3 House C
        const houseTypes = ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C'];

        // Shuffle with seeded PRNG (Fisher-Yates)
        for (let i = houseTypes.length - 1; i > 0; i--) {
            const j = Math.floor(this.rand() * (i + 1));
            const temp = houseTypes[i];
            houseTypes[i] = houseTypes[j];
            houseTypes[j] = temp;
        }

        // 5. Instantiate the 9 houses
        houseTypes.forEach((type, idx) => {
            const cell = gridPositions[idx];
            let houseMesh = null;
            const billboardIndex = idx; // Distinct billboard per house

            if (type === 'A') {
                houseMesh = this.createHouseA(billboardIndex);
            } else if (type === 'B') {
                houseMesh = this.createHouseB(billboardIndex);
            } else {
                houseMesh = this.createHouseC(billboardIndex);
            }

            // Procedural Rotation (multiples of 90 degrees)
            const rotQuads = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
            const rot = rotQuads[Math.floor(this.rand() * rotQuads.length)];
            houseMesh.rotation.y = rot;

            // Slight position jitter (+/- 2m) for natural street alignment
            const jitterX = (this.rand() - 0.5) * 3;
            const jitterZ = (this.rand() - 0.5) * 3;
            houseMesh.position.set(cell.x + jitterX, 0, cell.z + jitterZ);

            this.group.add(houseMesh);

            // Solid physics Box Collider for Character, Bots and Vehicles
            const hW = houseMesh.userData.width || 20;
            const hH = houseMesh.userData.height || 15;
            const hD = houseMesh.userData.depth || 20;
            const colGeom = new THREE.BoxGeometry(hW, hH, hD);
            const colMesh = new THREE.Mesh(colGeom, new THREE.MeshBasicMaterial({ visible: false }));
            colMesh.position.set(cell.x + jitterX, hH / 2, cell.z + jitterZ);
            this.group.add(colMesh);
            this.colliders.push(colMesh);

            const bbox = new THREE.Box3().setFromObject(houseMesh);
            const wX = cell.x + jitterX + this.center.x;
            const wZ = cell.z + jitterZ + this.center.z;
            this.cityBlocks.push({
                minX: bbox.min.x + this.center.x, maxX: bbox.max.x + this.center.x,
                minY: bbox.min.y, maxY: bbox.max.y,
                minZ: bbox.min.z + this.center.z, maxZ: bbox.max.z + this.center.z,
                height: houseMesh.userData.height || 10,
                centerX: wX,
                centerZ: wZ
            });
        });

        // 6. Floor Graffitis on the Asphalt
        const graffitiLocations = [
            { x: 0, z: 0, scale: 14, type: 0 },         // Central Intersection: ACCION CITY mural
            { x: -22, z: -22, scale: 9, type: 1 },      // Northwest Alley: Skull "NO SURRENDER"
            { x: 24, z: 22, scale: 11, type: 2 },       // Southeast Avenue: DRIFT ZONE
            { x: -25, z: 24, scale: 8, type: 3 },       // Southwest Crossing: DANGER AIR ACCESS
            { x: 22, z: -24, scale: 8, type: 1 },       // Northeast Street: Cyber Stencil
            { x: 0, z: -42, scale: 10, type: 2 },       // North Gate approach: Chevrons
            { x: 42, z: 0, scale: 9, type: 0 },         // East Avenue: Tag
            { x: -42, z: 0, scale: 8, type: 3 }         // West Alley: Hazard
        ];

        graffitiLocations.forEach((loc, gIdx) => {
            const gTex = this.createGraffitiTexture(loc.type);
            const gMat = new THREE.MeshBasicMaterial({
                map: gTex,
                transparent: true,
                opacity: 0.92,
                depthWrite: false
            });
            const gGeom = new THREE.PlaneGeometry(loc.scale, loc.scale);
            const gMesh = new THREE.Mesh(gGeom, gMat);
            gMesh.rotation.x = -Math.PI / 2;
            gMesh.rotation.z = (this.rand() - 0.5) * 0.8; // Organic spray angle
            gMesh.position.set(loc.x, 0.04, loc.z);
            this.group.add(gMesh);
        });

        // 7. Place Central Rooftop / Square Helipad
        this.createHelipad(0, 0, 0);

        // Add everything to scene
        this.scene.add(this.group);

        return {
            group: this.group,
            colliders: this.colliders,
            cityBlocks: this.cityBlocks,
            helipadPos: this.helipadPos ? this.helipadPos.clone().add(this.center) : this.center.clone()
        };
    }

    /* -------------------------------------------------------------
     * UPDATE LOOP (Pulsing lights through snow and fog)
     * ------------------------------------------------------------- */
    update(dt) {
        if (!this.beaconLights || this.beaconLights.length === 0) return;
        const time = performance.now() * 0.001;
        for (let i = 0; i < this.beaconLights.length; i++) {
            const b = this.beaconLights[i];
            const pulse = (Math.sin(time * b.speed + b.phase) + 1.0) * 0.5; // 0 to 1
            const scale = b.baseScale * (0.8 + pulse * 0.6);
            b.sprite.scale.set(scale, scale, 1);
        }
    }
}
