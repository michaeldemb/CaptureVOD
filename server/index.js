const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const crypto = require('crypto');

const PORT = parseInt(process.env.APP_PORT || '8080', 10);
const DATA_ROOT = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');
const API_KEYS = parseApiKeys(process.env.API_KEYS || 'admin:CHANGE_ME,ingest:CHANGE_ME');
const DB_PATH = path.join(DATA_ROOT, 'db', 'app.sqlite');

ensureDirs();
initDb();

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    if (req.method === 'POST' && parsed.pathname === '/ingest/channel-events') {
      return await handleIngest(req, res, 'channel-events');
    }
    if (req.method === 'POST' && parsed.pathname === '/ingest/scte-events') {
      return await handleIngest(req, res, 'scte-events');
    }
    if (req.method === 'GET' && parsed.pathname === '/search/events') {
      return await handleSearch(req, res, parsed.query);
    }
    if (req.method === 'POST' && parsed.pathname === '/export/hls') {
      return await handleExport(req, res);
    }
    if (req.method === 'GET' && parsed.pathname.startsWith('/hls/')) {
      return serveFile(path.join(DATA_ROOT, parsed.pathname));
    }
    if (req.method === 'GET' && (parsed.pathname === '/' || parsed.pathname === '/index.html')) {
      return serveFile(path.join(__dirname, '..', 'web', 'index.html'), res);
    }
    if (req.method === 'GET' && parsed.pathname === '/app.js') {
      return serveFile(path.join(__dirname, '..', 'web', 'app.js'), res, 'application/javascript');
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('Internal error');
  }
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

function parseApiKeys(str) {
  const map = {};
  str.split(',').forEach(pair => {
    const [role, key] = pair.split(':');
    if (role && key) map[role.trim()] = key.trim();
  });
  return map;
}

function ensureDirs() {
  const dirs = [DATA_ROOT, path.join(DATA_ROOT, 'events', 'channel-events'), path.join(DATA_ROOT, 'events', 'scte-events'), path.join(DATA_ROOT, 'deadletter', 'channel-events'), path.join(DATA_ROOT, 'deadletter', 'scte-events'), path.join(DATA_ROOT, 'db'), path.join(DATA_ROOT, 'exports')];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function initDb() {
  const sql = `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, index_name TEXT, timestamp TEXT, label TEXT, raw TEXT);`;
  execFile('sqlite3', [DB_PATH, sql], (err) => {
    if (err) console.error('DB init error', err);
  });
}

function authenticate(req, role) {
  const key = req.headers['x-api-key'];
  return key && API_KEYS[role] && API_KEYS[role] === key;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const json = JSON.parse(data || 'null');
        resolve(json);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function handleIngest(req, res, indexName) {
  if (!authenticate(req, 'ingest')) {
    res.writeHead(401); res.end('unauthorized'); return;
  }
  const body = await parseBody(req);
  const events = Array.isArray(body) ? body : [body];
  const schema = getSchema(indexName);
  const validEvents = [];
  const invalidEvents = [];
  events.forEach(ev => {
    if (validateAgainstSchema(ev, schema)) {
      validEvents.push(ev);
    } else {
      invalidEvents.push(ev);
    }
  });

  const date = new Date();
  const folder = path.join(DATA_ROOT, 'events', indexName, date.getUTCFullYear().toString().padStart(4, '0'), (date.getUTCMonth()+1).toString().padStart(2, '0'), date.getUTCDate().toString().padStart(2, '0'));
  fs.mkdirSync(folder, { recursive: true });
  const ndjsonPath = path.join(folder, `events-${date.toISOString().slice(0,10).replace(/-/g,'')}.ndjson`);

  validEvents.forEach(ev => {
    fs.appendFileSync(ndjsonPath, JSON.stringify(ev) + '\n');
    indexEvent(ev, indexName);
  });

  if (invalidEvents.length) {
    const deadFolder = path.join(DATA_ROOT, 'deadletter', indexName);
    const deadPath = path.join(deadFolder, `invalid-${Date.now()}.ndjson`);
    fs.appendFileSync(deadPath, invalidEvents.map(e => JSON.stringify(e)).join('\n') + '\n');
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ingested: validEvents.length, invalid: invalidEvents.length }));
}

function getSchema(indexName) {
  const schemaPath = path.join(__dirname, '..', 'schemas', `${indexName}.json`);
  try {
    return JSON.parse(fs.readFileSync(schemaPath));
  } catch (e) {
    return { required: ['uuid', 'timestamp'] };
  }
}

function validateAgainstSchema(obj, schema) {
  if (!obj || typeof obj !== 'object') return false;
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in obj)) return false;
    }
  }
  return true;
}

function indexEvent(ev, indexName) {
  const uuid = ev.uuid || crypto.randomUUID();
  const timestamp = ev.timestamp || '';
  const label = ev.label || '';
  const raw = JSON.stringify(ev).replace(/'/g, "''");
  const sql = `INSERT OR IGNORE INTO events (id,index_name,timestamp,label,raw) VALUES ('${uuid}','${indexName}','${timestamp}','${label}','${raw}');`;
  execFile('sqlite3', [DB_PATH, sql], (err) => {
    if (err) console.error('DB insert error', err);
  });
}

async function handleSearch(req, res, query) {
  if (!authenticate(req, 'admin')) { res.writeHead(401); res.end('unauthorized'); return; }
  const index = query.index || 'channel-events';
  const from = query.from || '0000-01-01T00:00:00Z';
  const to = query.to || '9999-12-31T23:59:59Z';
  const limit = parseInt(query.limit || '100', 10);
  const sql = `SELECT raw FROM events WHERE index_name='${index}' AND timestamp BETWEEN '${from}' AND '${to}' ORDER BY timestamp LIMIT ${limit};`;
  execFile('sqlite3', [DB_PATH, '-json', sql], (err, stdout) => {
    if (err) { res.writeHead(500); res.end('db error'); return; }
    const rows = stdout ? JSON.parse(stdout) : [];
    const events = rows.map(r => JSON.parse(r.raw));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events }));
  });
}

async function handleExport(req, res) {
  if (!authenticate(req, 'admin')) { res.writeHead(401); res.end('unauthorized'); return; }
  const body = await parseBody(req);
  const channel = body.channel_label;
  const from = new Date(body.from);
  const to = new Date(body.to);
  const hlsPath = path.join(DATA_ROOT, 'hls', channel);
  const playlist = selectPlaylist(hlsPath);
  if (!playlist) { res.writeHead(404); res.end('playlist not found'); return; }
  const segments = parsePlaylist(playlist.file, from, to);
  const exportDir = path.join(DATA_ROOT, 'exports', channel, `export_${body.from}_${body.to}`);
  fs.mkdirSync(exportDir, { recursive: true });
  const newPlaylistPath = path.join(exportDir, path.basename(playlist.file));
  let mediaSeq = 0;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-MEDIA-SEQUENCE:0'];
  segments.forEach(seg => {
    const rel = path.relative(hlsPath, seg.path);
    const target = path.join(exportDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(seg.path, target);
    lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
    lines.push(rel.replace(/\\/g,'/'));
    mediaSeq++;
  });
  lines.push('#EXT-X-ENDLIST');
  fs.writeFileSync(newPlaylistPath, lines.join('\n'));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ url: `/exports/${encodeURIComponent(channel)}/${encodeURIComponent(path.basename(exportDir))}/${path.basename(newPlaylistPath)}` }));
}

function selectPlaylist(channelPath) {
  if (!fs.existsSync(channelPath)) return null;
  const files = fs.readdirSync(channelPath);
  const base = path.basename(channelPath);
  const master = path.join(channelPath, `${base}_profile.m3u8`);
  const main = path.join(channelPath, `${base}.m3u8`);
  if (files.includes(`${base}_profile.m3u8`)) return { file: master };
  if (files.includes(`${base}.m3u8`)) return { file: main };
  return null;
}

function parsePlaylist(playlistPath, from, to) {
  const content = fs.readFileSync(playlistPath, 'utf8');
  const lines = content.split(/\r?\n/);
  let currentTime = null;
  const segments = [];
  let lastExtinf = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
      const t = new Date(line.split(':')[1].trim());
      currentTime = t;
    } else if (line.startsWith('#EXTINF')) {
      const dur = parseFloat(line.split(':')[1]);
      lastExtinf = dur;
    } else if (!line.startsWith('#') && line.trim().length) {
      if (currentTime === null) currentTime = new Date(0);
      const segStart = new Date(currentTime);
      const segEnd = new Date(segStart.getTime() + lastExtinf * 1000);
      if (segEnd > from && segStart < to) {
        segments.push({ path: path.resolve(path.dirname(playlistPath), line), duration: lastExtinf });
      }
      currentTime = segEnd;
    }
  }
  return segments;
}

function serveFile(filePath, res = null, contentType) {
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (res) {
      res.writeHead(404); res.end('not found');
    }
  });
  if (res) {
    if (contentType) res.writeHead(200, { 'Content-Type': contentType });
    else res.writeHead(200);
    stream.pipe(res);
  } else {
    return stream;
  }
}

module.exports = { parsePlaylist }; // for testing
