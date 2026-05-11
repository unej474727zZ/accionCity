const https = require('https');

module.exports = async (req, res) => {
  // Test Route: Visit in browser to verify deployment AND send a test to Discord
  if (req.method === 'GET') {
    const testPayload = JSON.stringify({
      content: "🔔 **¡PRUEBA DE CONEXIÓN!** Si ves esto, Discord y Vercel funcionan perfectamente. El problema es Localtonet que no está enviando los datos."
    });

    const url = new URL('https://discord.com/api/webhooks/1502875072862490727/HDEzz71U_GhfqQetVoHgXlltQDD-txQslbxqLnxSuLKGXJqF4M8EwnPzJilPXI_w95J3');
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(testPayload)
      }
    };

    const discordReq = https.request(options);
    discordReq.write(testPayload);
    discordReq.end();

    return res.status(200).send('¡Mensaje de prueba enviado a Discord! Si no lo ves, revisa tu URL de webhook.');
  }

  console.log("--- WEBHOOK INCOMING ---");
  console.log("Method:", req.method);
  
  // Robust Body Parsing (Handle buffers if not parsed)
  let body = req.body;
  if (Buffer.isBuffer(req.body)) {
    try {
      body = JSON.parse(req.body.toString());
    } catch (e) {
      console.error("Failed to parse body buffer:", e.message);
    }
  }

  console.log("Body:", JSON.stringify(body, null, 2));

  const { Id, Type, Status, ActionDate } = body || {};
  const DISCORD_URL = 'https://discord.com/api/webhooks/1502875072862490727/HDEzz71U_GhfqQetVoHgXlltQDD-txQslbxqLnxSuLKGXJqF4M8EwnPzJilPXI_w95J3';

  if (!Id && !Status) {
    console.warn("No data found in request.");
    return res.status(400).send('No Data');
  }

  const isConnected = Status === 'Connected';
  const emoji = isConnected ? '✅' : '❌';
  const color = isConnected ? 0x00ff00 : 0xff0000;

  const discordPayload = JSON.stringify({
    embeds: [{
      title: `${emoji} AccionCity Cloud: ${Status}`,
      description: `Estado reportado por Localtonet.`,
      color: color,
      fields: [
        { name: 'Tipo', value: Type || 'N/A', inline: true },
        { name: 'ID', value: `\`${Id}\``, inline: true },
        { name: 'Hora', value: ActionDate ? new Date(ActionDate).toLocaleString() : new Date().toLocaleString(), inline: false }
      ],
      footer: { text: 'Cloud Monitor Active' },
      timestamp: new Date()
    }]
  });

  const url = new URL(DISCORD_URL);
  const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(discordPayload)
    }
  };

  const discordReq = https.request(options, (discordRes) => {
    console.log(`Discord Response: ${discordRes.statusCode}`);
  });
  
  discordReq.on('error', (e) => console.error(`Discord Error: ${e.message}`));
  discordReq.write(discordPayload);
  discordReq.end();

  return res.status(200).json({ message: 'OK' });
};
