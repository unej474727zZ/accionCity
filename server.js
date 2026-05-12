const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*", // Allow any origin for dev
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// State
const players = {};

app.use(express.static('public')); // Serve public assets if needed directly

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Random Color Generator (Vivid/Neon)
  const getRandomNeonColor = () => {
    // HSV to Hex conversion for pure vivid colors
    // Saturation 100%, Lightness 50% = Maximum pure color
    const h = Math.random();
    const s = 0.9;
    const l = 0.5;

    const r = l;
    // Simplified HSL to RGB conversion for S=1, L=0.5 (approximated for max vividness)
    // Actually, proper conversion is better to ensure valid Hex.

    // Using a robust HSL to Hex function
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    // Random Hue (0-1)
    const r_val = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g_val = Math.round(hue2rgb(p, q, h) * 255);
    const b_val = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);

    const toHex = (c) => {
      const hex = c.toString(16);
      return hex.length == 1 ? "0" + hex : hex;
    };

    return "#" + toHex(r_val) + toHex(g_val) + toHex(b_val);
  };

  const finalColor = getRandomNeonColor();
  const randomName = 'Player ' + Math.floor(Math.random() * 10000);

  // Create new player entry
  players[socket.id] = {
    x: 0, y: 0, z: 0,
    rot: 0,
    state: 'idle',
    color: finalColor, // Vivid Hex
    name: randomName
  };

  // Send current players to new joiner
  socket.emit('currentPlayers', players);

  // Broadcast new joiner to others
  socket.broadcast.emit('newPlayer', {
    id: socket.id,
    player: players[socket.id]
  });

  // Handle Movement
  socket.on('playerMove', (data) => {
    if (players[socket.id]) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
      players[socket.id].z = data.z;
      players[socket.id].rot = data.rot;
      players[socket.id].state = data.state;

      // Broadcast update to others (excluding sender)
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        ...data
      });
    }
  });

  // Handle Shooting
  socket.on('playerShoot', (data) => {
    socket.broadcast.emit('playerShoot', { id: socket.id, ...data });
  });

  // Handle Hits (Impacts)
  socket.on('playerHit', (data) => {
    // Broadcast to everyone so they see the blood/spark
    io.emit('playerHit', { id: socket.id, ...data });
  });

  // Handle Chat
  socket.on('chatMessage', (data) => {
    const player = players[socket.id];
    if (player) {
      // Broadcast to EVERYONE (including sender)
      io.emit('chatMessage', {
        id: socket.id,
        name: player.name,
        color: player.color,
        text: data.text
      });
    }
  });

  // Handle Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});


http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
