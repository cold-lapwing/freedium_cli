'use strict';

// OS detection + freedium config file (~/.freedium/config.json).
// Zero runtime dependencies; persists image mode, host, image width and any
// future preferences so users don't have to pass CLI flags every time.

const { homedir } = require('node:os');
const { join } = require('node:path');
const { accessSync, readFileSync, writeFileSync } = require('node:fs');

const CONFIG_DIR = join(homedir(), '.freedium');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const SUPPORTED_OS = new Set(['linux', 'macos', 'windows', 'freebsd']);

const DETECTED = (() => {
  const plat = (process.platform || '').toLowerCase();
  if (plat === 'darwin') return 'macos';
  if (plat === 'win32') return 'windows';
  if (plat === 'freebsd') return 'freebsd';
  if (plat === 'linux') return 'linux';
  return 'unknown';
})();

function detectOs() {
  return DETECTED;
}

function readEnvOs() {
  const raw = (process.env.FREEDIUM_OS || '').trim();
  return raw ? raw.toLowerCase() : null;
}

function resolveOs() {
  const env = readEnvOs();
  if (env && SUPPORTED_OS.has(env)) return env;
  const d = detectOs();
  if (d !== 'unknown') return d;
  if (env) {
    // allow arbitrary string if user insists; it just won't match any image
    // mode below and images will degrade to the text placeholder.
    return env;
  }
  return d;
}

function readConfig() {
  let raw;
  try {
    accessSync(CONFIG_FILE, 4);  // R_OK
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeConfig(doc) {
  // saveConfig already created the directory; just write the file.
  writeFileSync(CONFIG_FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
}

// Best-effort: create dir if missing, then write. Never throw (config is
// optional; a write failure should not break the CLI).
function saveConfig(doc) {
  try {
    const dir = CONFIG_DIR;
    try {
      const { mkdirSync } = require('node:fs');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      // dir already present or unwritable — fall through
    }
    writeConfig(doc);
  } catch {
    // config is best-effort; ignore silently
  }
}

function osImageMode(osName) {
  // Map detected OS to the image rendering strategy that actually works
  // in that terminal. linux/mac/windows already handled in images.js's
  // resolveMode; this returns the darwin-specific "iterm2" mode.
  const o = (osName || '').toLowerCase();
  if (o === 'darwin' || o === 'macos') return 'iterm2';
  if (o === 'windows') return 'windows';
  return 'auto';
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  detectOs,
  resolveOs,
  readEnvOs,
  osImageMode,
  readConfig,
  writeConfig,
  saveConfig,
};
