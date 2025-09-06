const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DATA_ROOT = path.join(__dirname, '..', 'test_data');
fs.rmSync(DATA_ROOT, { recursive: true, force: true });
fs.mkdirSync(DATA_ROOT, { recursive: true });

// prepare dummy HLS
const hlsDir = path.join(DATA_ROOT, 'hls', 'demo');
fs.mkdirSync(hlsDir, { recursive: true });
fs.writeFileSync(path.join(hlsDir, 'demo.m3u8'), `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:8\n#EXT-X-PROGRAM-DATE-TIME:2025-09-06T12:00:00Z\n#EXTINF:4.0,\nseg1.ts\n#EXTINF:4.0,\nseg2.ts\n#EXT-X-ENDLIST`);
fs.writeFileSync(path.join(hlsDir, 'seg1.ts'), 'dummy1');
fs.writeFileSync(path.join(hlsDir, 'seg2.ts'), 'dummy2');

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch(e){ reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const server = spawn('node', ['server/index.js'], {
    env: { ...process.env, APP_PORT: '8090', DATA_ROOT, API_KEYS: 'admin:adminkey,ingest:ingestkey' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(resolve => {
    server.stdout.on('data', d => {
      if (d.toString().includes('Server listening')) resolve();
    });
  });

  // ingest
  const event = { uuid: '1', timestamp: '2025-09-06T12:00:00Z', label: 'start' };
  let res = await request({ method: 'POST', port: 8090, path: '/ingest/channel-events', headers: { 'Content-Type': 'application/json', 'x-api-key': 'ingestkey' } }, JSON.stringify(event));
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.ingested, 1);

  // search
  res = await request({ method: 'GET', port: 8090, path: '/search/events?index=channel-events', headers: { 'x-api-key': 'adminkey' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.events.length, 1);
  assert.strictEqual(res.body.events[0].uuid, '1');

  // export
  const body = { channel_label: 'demo', from: '2025-09-06T12:00:00Z', to: '2025-09-06T12:00:05Z' };
  res = await request({ method: 'POST', port: 8090, path: '/export/hls', headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminkey' } }, JSON.stringify(body));
  assert.strictEqual(res.status, 200);
  const exportDir = path.join(DATA_ROOT, 'exports', 'demo');
  const sub = fs.readdirSync(exportDir)[0];
  const playlistPath = path.join(exportDir, sub, 'demo.m3u8');
  assert(fs.existsSync(playlistPath));

  server.kill();
  console.log('Tests passed');
})();
