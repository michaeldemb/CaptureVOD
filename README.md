# CaptureVOD

CaptureVOD is a lightweight Node.js application for ingesting JSON event logs and HLS recordings. It provides a simple API for ingest/search/export and a minimal web UI with a timeline and HLS player.

## Features
- HTTP APIs for ingesting channel events and SCTE events.
- NDJSON storage and SQLite index for quick searches.
- Static HLS file serving and basic export of time ranges.
- Minimal HTML/JavaScript frontend using [hls.js](https://github.com/video-dev/hls.js).
- Docker container and docker-compose setup.

## Running locally
```
node server/index.js
```
The server listens on port `8080` by default and uses `./data` for storage. API keys are provided via the `API_KEYS` env variable (`admin` and `ingest` roles).

## Docker
Build and run with docker compose:
```
docker compose build
docker compose up -d
```
Access the UI at http://localhost:8080/.

## Tests
Run unit tests:
```
npm test
```
