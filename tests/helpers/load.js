/**
 * Loads the PrintBridge modules into the global scope (globalThis.PrintBridge), the same way the <script> tags do.
 * Only the files without DOM: drawing.js (render only), ui.js and app.js need a browser.
 * The order is that of the HTML.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function load(files) {
  for (const file of files) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  }
  return globalThis.PrintBridge;
}

module.exports = { load };
