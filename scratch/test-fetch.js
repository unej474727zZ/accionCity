const fetch = require('node-fetch');
const https = require('https');

async function testFetch() {
  const url = 'https://monitor-proxy-six.vercel.app/api/webhook';
  
  console.log('Testing default fetch...');
  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ test: 1 }) });
    console.log('Default fetch success:', res.status);
  } catch (err) {
    console.error('Default fetch error:', err.message);
  }

  console.log('Testing IPv4 fetch...');
  try {
    const agent = new https.Agent({ family: 4 });
    const res = await fetch(url, { method: 'POST', body: JSON.stringify({ test: 1 }), agent });
    console.log('IPv4 fetch success:', res.status);
  } catch (err) {
    console.error('IPv4 fetch error:', err.message);
  }
}

testFetch();
