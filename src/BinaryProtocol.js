/**
 * Binary Protocol for AccionCity
 * Packets:
 * 1. Client -> Server: 'playerMoveBin' (24 bytes)
 *    [0..3]   Float32: x
 *    [4..7]   Float32: y
 *    [8..11]  Float32: z
 *    [12..15] Float32: yaw
 *    [16..19] Float32: pitch
 *    [20]     Uint8: stateId
 *    [21]     Uint8: weaponId
 *    [22]     Uint8: vehicleId
 *    [23]     Uint8: flags (bit 0 = firing)
 *
 * 2. Server -> Client: 'playerMovedBin' (26 bytes)
 *    [0..1]   Uint16: slotId
 *    [2..5]   Float32: x
 *    [6..9]   Float32: y
 *    [10..13] Float32: z
 *    [14..17] Float32: yaw
 *    [18..21] Float32: pitch
 *    [22]     Uint8: stateId
 *    [23]     Uint8: weaponId
 *    [24]     Uint8: vehicleId
 *    [25]     Uint8: flags (bit 0 = firing)
 */

export const STATE_IDS = {
    'idle': 0,
    'walk': 1,
    'run': 2,
    'backward': 3,
    'jump': 4,
    'shooting': 5,
    'firing': 6,
    'driving': 7,
    'dead': 8
};

export const STATE_NAMES = [
    'idle',
    'walk',
    'run',
    'backward',
    'jump',
    'shooting',
    'firing',
    'driving',
    'dead'
];

export const WEAPON_IDS = {
    'none': 0,
    'pistol': 1,
    'rifle': 2,
    'bazooka': 3
};

export const WEAPON_NAMES = ['none', 'pistol', 'rifle', 'bazooka'];

export const VEHICLE_IDS = {
    'none': 0,
    'motorcycle': 1,
    'tank': 2,
    'helicopter': 3
};

export const VEHICLE_NAMES = ['none', 'motorcycle', 'tank', 'helicopter'];

// Single pre-allocated send buffer for client (Zero Allocation per tick)
const CLIENT_BUFFER = new ArrayBuffer(24);
const CLIENT_VIEW = new DataView(CLIENT_BUFFER);

export function encodeClientMove(pos, yaw, pitch, state, weaponType, firing, vehicleType) {
    CLIENT_VIEW.setFloat32(0, pos.x, true);
    CLIENT_VIEW.setFloat32(4, pos.y, true);
    CLIENT_VIEW.setFloat32(8, pos.z, true);
    CLIENT_VIEW.setFloat32(12, yaw || 0, true);
    CLIENT_VIEW.setFloat32(16, pitch || 0, true);

    const stateId = STATE_IDS[state] !== undefined ? STATE_IDS[state] : 0;
    const weaponId = WEAPON_IDS[weaponType] !== undefined ? WEAPON_IDS[weaponType] : 0;
    const vehicleId = VEHICLE_IDS[vehicleType] !== undefined ? VEHICLE_IDS[vehicleType] : 0;
    const flags = firing ? 1 : 0;

    CLIENT_VIEW.setUint8(20, stateId);
    CLIENT_VIEW.setUint8(21, weaponId);
    CLIENT_VIEW.setUint8(22, vehicleId);
    CLIENT_VIEW.setUint8(23, flags);

    return CLIENT_BUFFER;
}

// Reusable object for decoding (Zero Allocation per received packet)
export const DECODED_MOVE = {
    slot: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    state: 'idle',
    weaponType: 'none',
    vehicleType: null,
    firing: false
};

export function decodeServerMove(buffer) {
    const view = buffer instanceof DataView ? buffer : new DataView(buffer);
    
    DECODED_MOVE.slot = view.getUint16(0, true);
    DECODED_MOVE.x = view.getFloat32(2, true);
    DECODED_MOVE.y = view.getFloat32(6, true);
    DECODED_MOVE.z = view.getFloat32(10, true);
    DECODED_MOVE.yaw = view.getFloat32(14, true);
    DECODED_MOVE.pitch = view.getFloat32(18, true);

    const stateId = view.getUint8(22);
    const weaponId = view.getUint8(23);
    const vehicleId = view.getUint8(24);
    const flags = view.getUint8(25);

    DECODED_MOVE.state = STATE_NAMES[stateId] || 'idle';
    DECODED_MOVE.weaponType = WEAPON_NAMES[weaponId] || 'none';
    DECODED_MOVE.vehicleType = vehicleId > 0 ? (VEHICLE_NAMES[vehicleId] || null) : null;
    DECODED_MOVE.firing = (flags & 1) === 1;

    return DECODED_MOVE;
}
