#!/usr/bin/env node
/**
 * Syntax-check every backend + frontend JS file via `node --check`.
 * Used locally (`npm run check`) and in CI. Exits non-zero on the first failure.
 * Pure parse check — does not execute the modules (safe without env/devices).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROOTS = ['src', path.join('public', 'js'), 'scripts'];
const files = [];

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (entry.isFile() && rel.endsWith('.js')) files.push(rel);
  }
}

ROOTS.forEach(walk);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    const msg = (err.stderr || err.stdout || err.message || '').toString().trim();
    console.error(`✗ ${f}\n${msg}\n`);
  }
}

if (failed) {
  console.error(`${failed} of ${files.length} file(s) FAILED syntax check.`);
  process.exit(1);
}
console.log(`✓ ${files.length} JS file(s) passed node --check.`);
