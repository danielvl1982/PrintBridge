/**
 * Loads the PrintBridge modules into the global scope (globalThis.PrintBridge), the same way the <script> tags do.
 * The file order comes from js/manifest.json, the single list shared with index.html (a test keeps them in sync).
 * Files that need a browser DOM (js/ui.js, js/app.js) are never loaded by loadApp().
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const LEGACY_EXAMPLES = require('./legacy-examples.js');
const DOM_FILES = ['js/ui.js', 'js/app.js'];

/** The ordered list of every script, as in index.html. */
function manifest() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'js', 'manifest.json'), 'utf8'));
}

function load(files) {
  for (const file of files) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
    // The complete sample labels are a test fixture, not part of the shipped app: append them after js/config.js
    if (file === 'js/config.js') {
      globalThis.PrintBridge.examples = Object.freeze([...globalThis.PrintBridge.examples, ...LEGACY_EXAMPLES]);
    }
  }
  return globalThis.PrintBridge;
}

/** The examples the app ships: js/config.js alone, in a fresh context, without the fixture that load() appends. */
function shippedExamples() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8'), context, { filename: 'js/config.js' });
  return context.PrintBridge.examples;
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

module.exports = { LEGACY_EXAMPLES, shippedExamples, load, manifest, loadUpTo, loadApp };
