async function init() {
  const apiKey = 'admin'; // placeholder; for demo using key directly
  const res = await fetch('/search/events?index=channel-events&limit=50', { headers: { 'x-api-key': apiKey } });
  const data = await res.json();
  const timeline = document.getElementById('timeline');
  data.events.forEach(ev => {
    const div = document.createElement('div');
    div.className = 'event';
    div.textContent = `${ev.timestamp} - ${ev.label || ev.event_type}`;
    div.onclick = () => seekTo(ev.timestamp);
    timeline.appendChild(div);
  });
  await setupPlayer('demo');
}

let hls, firstProgramDate;

async function setupPlayer(channel) {
  const video = document.getElementById('video');
  const playlistUrl = `/hls/${channel}/${channel}.m3u8`;
  const resp = await fetch(playlistUrl);
  const text = await resp.text();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME')) {
      firstProgramDate = new Date(line.split(':')[1].trim());
      break;
    }
  }
  if (Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(playlistUrl);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = playlistUrl;
  }
}

function seekTo(ts) {
  if (!firstProgramDate) return;
  const video = document.getElementById('video');
  const t = new Date(ts);
  const offset = (t - firstProgramDate) / 1000;
  if (offset >= 0) {
    video.currentTime = offset;
  }
}

init();
