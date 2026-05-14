require('dotenv').config({ path: './notifywebhook.env' });
const fetch = require('node-fetch');
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.NOTIFY_WEBHOOK_URL;

// Notification Helper
const sendNotify = async (title, message, color = 0x00ff00) => {
  if (!WEBHOOK_URL) {
    console.log('⚠️ No hay URL de Webhook configurada.');
    return;
  }
  try {
    console.log(`📡 Intentando enviar notificación: "${title}"...`);
    
    // Enviamos como JSON (el estándar más fiable)
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ 
        title: title, 
        message: message, 
        color: color.toString() 
      })
    });
    
    const resText = await response.text();
    if (response.ok) {
        console.log(`✅ ¡Notificación enviada con éxito!`);
    } else {
        console.log(`❌ Error del Webhook (${response.status}): ${resText}`);
        // Si el proxy falló por "No Data", puede ser que no esté leyendo JSON.
        // Pero con el nuevo proxy que te he creado esto no pasará.
    }
  } catch (err) {
    console.error('❌ Error de conexión:', err.message);
  }
};

// Global Server State
const players = {};
let isPaused = false;

// Notify server start
sendNotify('🚀 Servidor Iniciado', `El servidor de AccionCity está corriendo en el puerto ${PORT}`);

io.on('connection', (socket) => {
  const ip = socket.handshake.address;
  const userAgent = socket.handshake.headers['user-agent'];
  console.log('User connected:', socket.id, 'IP:', ip);

  // Random Color Generator (Vivid/Neon)
  const getRandomNeonColor = () => {
    const h = Math.random();
    const s = 0.9;
    const l = 0.5;
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
    const toHex = (c) => {
      const hex = Math.round(c * 255).toString(16);
      return hex.length == 1 ? "0" + hex : hex;
    };
    return "#" + toHex(hue2rgb(p, q, h + 1 / 3)) + toHex(hue2rgb(p, q, h)) + toHex(hue2rgb(p, q, h - 1 / 3));
  };

  const finalColor = getRandomNeonColor();
  const randomName = 'Player ' + Math.floor(Math.random() * 10000);

  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * 5;
  players[socket.id] = {
    id: socket.id,
    x: -298 + Math.cos(angle) * radius,
    y: 0.5,
    z: -40 + Math.sin(angle) * radius,
    rot: 0,
    state: 'idle',
    color: finalColor,
    name: randomName,
    ip: ip
  };

  // Notify Player Entry
  sendNotify('👤 Jugador Conectado', 
    `**Nombre:** ${randomName}\n**IP:** ${ip}\n**ID:** ${socket.id}\n**Navegador:** ${userAgent}`,
    0x00ff00
  );

  socket.emit('currentPlayers', players);
  socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

  // Handle Pause
  socket.on('togglePause', (data) => {
    isPaused = data.paused;
    const player = players[socket.id];
    const status = isPaused ? '⏸️ JUEGO PAUSADO' : '▶️ JUEGO REANUDADO';
    
    // Solo mandamos el aviso al correo, NO bloqueamos a los demás
    sendNotify(status, `El jugador **${player ? player.name : 'Desconocido'}** ha ${isPaused ? 'puesto' : 'quitado'} la pausa individualmente.`);
  });

  socket.on('playerMove', (data) => {
    if (players[socket.id]) {
      Object.assign(players[socket.id], data);
      socket.broadcast.emit('playerMoved', { id: socket.id, ...data });
    }
  });

  socket.on('playerShoot', (data) => {
    socket.broadcast.emit('playerShoot', { id: socket.id, ...data });
  });

  socket.on('playerHit', (data) => {
    io.emit('playerHit', { id: socket.id, ...data });
  });

  socket.on('chatMessage', (data) => {
    const player = players[socket.id];
    if (player) {
      io.emit('chatMessage', {
        id: socket.id,
        name: player.name,
        color: player.color,
        text: data.text
      });
    }
  });

  socket.on('disconnect', () => {
    const player = players[socket.id];
    console.log('User disconnected:', socket.id);
    
    if (player) {
      sendNotify('❌ Jugador Desconectado', `**Nombre:** ${player.name}\n**ID:** ${socket.id}`, 0xff0000);
    }
    
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

// Manual Shutdown Notification
process.on('SIGINT', async () => {
  await sendNotify('🛑 Servidor Detenido', 'El servidor se ha cerrado manualmente desde la consola.', 0xffa500);
  process.exit();
});

http.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
