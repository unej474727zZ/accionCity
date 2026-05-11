import { io } from "socket.io-client";

export class NetworkManager {
    constructor() {
        this.socket = null;
        this.start = false;

        // Events
        this.onPlayerJoined = null;
        this.onPlayerMoved = null;
        this.onPlayerLeft = null;

        this.id = null;
    }

    connect() {
        // Connect to the same origin (the browser URL)
        // Vite proxy will handle forwarding /socket.io to port 3000
        const url = window.location.origin;
        console.log("Connecting to Socket.IO at:", url);

        this.socket = io(url, {
            reconnection: true,
            reconnectionAttempts: 10,
            transports: ['websocket', 'polling'],
            path: '/socket.io',
            forceNew: true
        });

        this.socket.on("connect_error", (err) => {
            console.error("Socket Connection Error:", err);
        });

        this.socket.on("connect", () => {
            console.log("Connected to server! ID:", this.socket.id);
            this.id = this.socket.id;
        });

        // 1. Initial State: Load all existing players
        this.socket.on('currentPlayers', (players) => {
            Object.keys(players).forEach((id) => {
                if (id !== this.id) {
                    if (this.onPlayerJoined) this.onPlayerJoined(id, players[id]);
                }
            });
        });

        // 2. New Player Joined
        this.socket.on('newPlayer', (data) => {
            if (this.onPlayerJoined) this.onPlayerJoined(data.id, data.player);
        });

        // 3. Player Moved
        this.socket.on('playerMoved', (data) => {
            if (this.onPlayerMoved) this.onPlayerMoved(data.id, data);
        });

        // 4. Player Left
        this.socket.on('playerDisconnected', (id) => {
            if (this.onPlayerLeft) this.onPlayerLeft(id);
        });

        this.socket.on('chatMessage', (data) => {
            if (this.onChatMessage) this.onChatMessage(data);
        });

        // 6. Player Shoot
        this.socket.on('playerShoot', (data) => {
            if (this.onPlayerShoot) this.onPlayerShoot(data);
        });

        // 7. Player Hit
        this.socket.on('playerHit', (data) => {
            if (this.onPlayerHit) this.onPlayerHit(data);
        });
    }

    sendUpdate(pos, yaw, pitch, state, weaponType, firing) {
        if (this.socket) {
            this.socket.emit('playerMove', {
                x: pos.x,
                y: pos.y,
                z: pos.z,
                yaw: yaw,
                pitch: pitch,
                state: state,
                weaponType: weaponType,
                firing: firing
            });
        }
    }

    sendShoot(origin, direction, weaponType) {
        if (this.socket) {
            this.socket.emit('playerShoot', { origin, direction, weaponType });
        }
    }

    sendHit(position, type, scale = 1.0) {
        if (this.socket) {
            this.socket.emit('playerHit', { position, type, scale });
        }
    }

    sendChat(text) {
        if (this.socket) {
            this.socket.emit('chatMessage', { text: text });
        }
    }
}
