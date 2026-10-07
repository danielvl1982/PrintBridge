/**
 * Loads the PrintBridge modules into the global scope (globalThis.PrintBridge), the same way the <script> tags do.
 * The file order comes from js/manifest.json, the single list shared with index.html (a test keeps them in sync).
 * Files that need a browser DOM (js/ui.js, js/app.js) are never loaded by loadApp().
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const DOM_FILES = ['js/ui.js', 'js/app.js'];

/** The ordered list of every script, as in index.html. */
function manifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'manifest.json'), 'utf8'));
}

function load(files) {
  for (const file of files) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  return globalThis.PrintBridge;
}

/** Loads the manifest files in order up to and including `file`. */
function loadUpTo(file) {
  const files = manifest();
  const index = files.indexOf(file);
  if (index < 0) throw new Error('Not in js/manifest.json: ' + file);
  return load(files.slice(0, index + 1));
}

/** Loads every manifest file that does not need a browser DOM. */
function loadApp() {
  return load(manifest().filter((file) => !DOM_FILES.includes(file)));
}

module.exports = { load, manifest, loadUpTo, loadApp };
