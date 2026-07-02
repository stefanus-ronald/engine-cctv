#!/usr/bin/env node
/**
 * rollback-v014.js — undo ALL of V-014 (ONVIF support: Fase 0 driver abstraction
 * + Fase 1 ONVIF live). Returns the tree to its pre-V-014 state.
 *
 * MODIFIED files (restored from their pre-V-014 backups):
 *   src/camera-manager.js   ← bak.<ts0>   (ts0 in Docs/.v014-backup-ts.txt)
 *   src/router.js           ← bak.<ts1>   (ts1 in Docs/.v014-fase1-backup-ts.txt)
 *   public/index.html       ← bak.<ts1>
 *   public/js/app.js        ← bak.<ts1>
 *   src/server.js               ← bak.<ts2>   (ts2 in Docs/.v014-fase2-backup-ts.txt)
 *   src/events/event-normalizer.js ← bak.<ts2>
 *   src/webrtc/playback-stream.js  ← bak.<ts4>   (ts4 in Docs/.v014-fase4-backup-ts.txt)
 *
 * ADDED files (deleted):
 *   src/drivers/device-driver.js, isapi-driver.js, onvif-driver.js
 *   src/onvif/ws-security.js, soap-client.js, ws-discovery.js, media.js
 *   src/onvif/events.js, onvif-event-manager.js, ptz.js, replay.js, capabilities.js
 *   scripts/test-onvif.js
 *   (this script, the backups and the V-014 doc are kept)
 *
 * Run from the project root:  node scripts/rollback-v014.js   (add --dry to preview)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[rollback-v014]', ...a);

function readTs(relTsFile) {
  const p = path.join(ROOT, relTsFile);
  if (!fs.existsSync(p)) { log(`WARN: ${relTsFile} not found`); return null; }
  return fs.readFileSync(p, 'utf8').trim();
}

function restore(targetRel, backupRel) {
  const target = path.join(ROOT, targetRel);
  const backup = path.join(ROOT, backupRel);
  if (!fs.existsSync(backup)) { log(`WARN: backup missing, skip: ${backupRel}`); return; }
  if (DRY) { log(`would restore ${targetRel} ← ${path.basename(backup)}`); return; }
  fs.copyFileSync(backup, target);
  log(`restored ${targetRel} ← ${path.basename(backup)}`);
}

function del(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  if (DRY) { log(`would delete ${rel}`); return; }
  fs.unlinkSync(p);
  log(`deleted ${rel}`);
}

function rmdirIfEmpty(rel) {
  const p = path.join(ROOT, rel);
  try {
    if (fs.existsSync(p) && fs.readdirSync(p).length === 0) {
      if (DRY) { log(`would remove empty ${rel}`); }
      else { fs.rmdirSync(p); log(`removed empty ${rel}`); }
    }
  } catch (e) { /* keep non-empty dir */ }
}

log(DRY ? 'DRY RUN — no files will be changed' : 'rolling back ALL of V-014 (Fase 0 + Fase 1)…');

const ts0 = readTs('Docs/.v014-backup-ts.txt');        // pre-Fase 0 (camera-manager)
const ts1 = readTs('Docs/.v014-fase1-backup-ts.txt');  // pre-Fase 1 (router/index/app)
const ts6 = readTs('Docs/.v014-fase6-backup-ts.txt');  // pre ONVIF discovery UI (style.css)
const ts2 = readTs('Docs/.v014-fase2-backup-ts.txt');  // pre-Fase 2 (server/event-normalizer)
const ts4 = readTs('Docs/.v014-fase4-backup-ts.txt');  // pre-Fase 4 (playback-stream)

if (ts0) restore('src/camera-manager.js', `src/camera-manager.js.bak.${ts0}`);
if (ts1) {
  restore('src/router.js', `src/router.js.bak.${ts1}`);
  restore('public/index.html', `public/index.html.bak.${ts1}`);
  restore('public/js/app.js', `public/js/app.js.bak.${ts1}`);
}
if (ts6) restore('public/css/style.css', `public/css/style.css.bak.${ts6}`);
if (ts2) {
  restore('src/server.js', `src/server.js.bak.${ts2}`);
  restore('src/events/event-normalizer.js', `src/events/event-normalizer.js.bak.${ts2}`);
}
if (ts4) restore('src/webrtc/playback-stream.js', `src/webrtc/playback-stream.js.bak.${ts4}`);

[
  'src/drivers/device-driver.js',
  'src/drivers/isapi-driver.js',
  'src/drivers/onvif-driver.js',
  'src/onvif/ws-security.js',
  'src/onvif/soap-client.js',
  'src/onvif/ws-discovery.js',
  'src/onvif/media.js',
  'src/onvif/events.js',
  'src/onvif/onvif-event-manager.js',
  'src/onvif/ptz.js',
  'src/onvif/replay.js',
  'src/onvif/capabilities.js',
  'scripts/test-onvif.js',
].forEach(del);

rmdirIfEmpty('src/onvif');
rmdirIfEmpty('src/drivers');

log('done. Run `npm run check` and restart the server to confirm.');
