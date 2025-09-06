// Simple retention cleanup script
const fs = require('fs');
const path = require('path');
const retentionDays = parseInt(process.env.RETENTION_DAYS || '30', 10);
const dataRoot = process.env.DATA_ROOT || path.join(__dirname, '..', 'data');

function isOlderThan(dir, days) {
  const stat = fs.statSync(dir);
  const age = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60 * 24);
  return age > days;
}

function removeOld(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(name => {
    const full = path.join(dir, name);
    if (isOlderThan(full, retentionDays)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  });
}

removeOld(path.join(dataRoot, 'events'));
removeOld(path.join(dataRoot, 'hls'));
removeOld(path.join(dataRoot, 'exports'));
