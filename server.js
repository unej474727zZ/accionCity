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

  // Create new player entry
  players[socket.id] = {
    x: 0, y: 0, z: 0,
    rot: 0,
    state: 'idle'
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
