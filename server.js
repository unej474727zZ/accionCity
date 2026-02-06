const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*", // Allow any origin for dev
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;

// State
const players = {};

app.use(express.static('public')); // Serve public assets if needed directly

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Random Color Generator (Bright/Pastel)
  // Fix: Generate high saturation/lightness to avoid black/dark colors
  const hue = Math.floor(Math.random() * 360);
  const randomColor = `hsl(${hue}, 100%, 70%)`; // HSL string works in many places, but for Three.js hex is safer.
  // Let's stick to Hex for Three.js compatibility, but strictly bright:
  // Simple bright hex: Ensure high values for RGB
  const brightColorToHex = () => {
    let c = new Date();
    return '#' + [0, 0, 0].map(() => {
      const val = Math.floor(128 + Math.random() * 127); // 128-255 range
      return val.toString(16).padStart(2, '0');
    }).join('');
  };
  const finalColor = brightColorToHex();
  const randomName = 'Player ' + Math.floor(Math.random() * 10000);

  // Create new player entry
  players[socket.id] = {
    x: 0, y: 0, z: 0,
    rot: 0,
    state: 'idle',
    color: finalColor, // Use the bright hex
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
