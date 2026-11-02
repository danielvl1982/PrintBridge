// Records the PrintBridge end-user demo video (WebM) with burned-in subtitles.
// Usage: npm run record   (output: video/out/printbridge-demo.webm, screenshots in video/out/shots)
// The print agent is simulated with page.route, so no printer or agent is needed.
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'out');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'shots'), { recursive: true });

const SIZE = { width: 1280, height: 720 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: out, size: SIZE } });
const page = await context.newPage();

// Simulated local print agent (the real one needs Windows and a printer).
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
await page.route('http://127.0.0.1:9631/**', (route) => {
  const url = new URL(route.request().url());
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (url.pathname === '/health') return route.fulfill({ headers: cors, body: JSON.stringify({ ok: true, version: '1.0.0', platform: 'win32' }) });
  if (url.pathname === '/printers') return route.fulfill({ headers: cors, body: JSON.stringify({ printers: [{ name: 'TEC B-EV4', isDefault: true, status: 'ready' }] }) });
  return route.fulfill({ headers: cors, body: JSON.stringify({ ok: true, bytes: 412, copies: 1 }) });
});

await page.goto(pathToFileURL(join(root, 'index.html')).href);

// Subtitle bar (top of the screen would hide the toolbars, so it sits at the bottom) and a visible mouse cursor.
await page.evaluate(() => {
  const cap = document.createElement('div');
  cap.id = 'demo-caption';
  cap.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:82%;padding:12px 22px;' +
    'background:rgba(0,0,0,.84);color:#fff;font:600 22px/1.35 system-ui,sans-serif;text-align:center;border-radius:10px;' +
    'z-index:99999;pointer-events:none;transition:opacity .25s;opacity:0';
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;' +
    'background:rgba(230,50,40,.55);border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,.6);z-index:99998;pointer-events:none';
  document.body.append(cap, dot);
  document.addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
});

const caption = async (text, ms = 3500, top = false) => {
  await page.evaluate(([t, onTop]) => {
    const e = document.getElementById('demo-caption');
    e.textContent = t; e.style.opacity = 1;
    e.style.bottom = onTop ? 'auto' : '22px'; e.style.top = onTop ? '62px' : 'auto';
  }, [text, top]);
  await page.waitForTimeout(ms);
};
const hideCaption = () => page.evaluate(() => { document.getElementById('demo-caption').style.opacity = 0; });
const shot = (name) => page.screenshot({ path: join(out, 'shots', `${name}.png`) });
const show = (heading) => page.locator('h2, .strip-title', { hasText: heading }).first().scrollIntoViewIfNeeded();
const labelText = (txt) => page.locator('#svgwrap svg text', { hasText: txt }).first();

/** Slow drag of a label item by (dx, dy) pixels so it is easy to follow. */
async function drag(locator, dx, dy) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  const x = b.x + 24, y = b.y + b.height / 2;
  await page.mouse.move(x, y, { steps: 20 });
  await page.waitForTimeout(400);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 45 });
  await page.mouse.up();
}

// 1. Intro
await caption('PrintBridge: mira cómo queda tu etiqueta sin imprimirla', 4000);
await shot('01-intro');

// 2. Load a label
await caption('Elige un ejemplo, o pega tu código, o arrastra tu archivo (.ter, .zpl, .prn…)', 4500);
await page.locator('#example').selectOption('template-tpcl');
await caption('La vista previa se dibuja al instante', 3500);
await shot('02-loaded');

// 3. Select an item: properties + command help
await show('Código de etiqueta');
await caption('Haz clic en cualquier elemento de la etiqueta para seleccionarlo', 3000);
await labelText('ETIQUETA BASICA').click({ force: true });
await show('Propiedades');
await caption('En «Propiedades» ves y cambias sus valores: fuente, rotación, contenido…', 4500);
await shot('03-properties');
await show('Ayuda del comando');
await caption('Y «Ayuda del comando» te explica, en castellano, qué significa cada número del código', 5000);
await shot('04-help');

// 4. Edit the content
await show('Propiedades');
await caption('Vamos a cambiar el título', 2500);
const content = page.locator('label', { hasText: 'Contenido' }).locator('input').first();
await content.click();
await content.press('Control+A');
await content.pressSequentially('ETIQUETA DE PRODUCTO', { delay: 90 });
await page.waitForTimeout(800);
await caption('La vista previa y el código se actualizan a la vez', 3500);
await shot('05-edit');

// 5. Move an item and get a warning
await caption('También puedes arrastrar los elementos con el ratón', 3000);
await drag(labelText(/^Producto:/), 40, 28);
await caption('Si un texto pisa a otro, queda marcado en la vista previa…', 3500);
await shot('06-overlap');
await show('Avisos');
await caption('…y «Avisos» te explica el problema antes de imprimir', 4500, true);
await shot('07-warnings');
await caption('Lo devolvemos a su sitio y el aviso desaparece', 2500);
await drag(labelText(/^Producto:/), -40, -28);
await page.waitForTimeout(1200);
await shot('08-overlap-fixed');

// 6. Variables
await show('Variables');
await page.locator('h2', { hasText: 'Variables' }).click();
await caption('Los datos que cambian en cada etiqueta (#PRODUCTO#, #LOTE#…) son variables', 4000);
const vars = page.locator('#vars input');
await vars.nth(0).click();
await vars.nth(0).press('Control+A');
await vars.nth(0).pressSequentially('Tuerca M10 x 25', { delay: 80 });
await vars.nth(1).click();
await vars.nth(1).press('Control+A');
await vars.nth(1).pressSequentially('L2026-0999', { delay: 80 });
await caption('Escribe valores de prueba y mira cómo quedaría con datos reales', 4500);
await labelText(/^Producto:/).scrollIntoViewIfNeeded();
await page.waitForTimeout(1500);
await shot('09-variables');

// 7. Add components
await show('Componentes');
await caption('La paleta «Componentes» añade textos, códigos de barras, QR, líneas, cajas e imágenes', 5000);
for (const name of ['Texto', 'Código de barras', 'QR', 'Caja']) {
  await page.locator('.strip-title', { hasText: 'Componentes' }).locator('xpath=..').getByText(name).first().hover();
  await page.waitForTimeout(700);
}
await caption('Pulsa uno y se añade a tu etiqueta, ya escrito en el lenguaje de tu impresora', 4500);
await shot('10-components');

// 8. View options
await show('Formato');
await caption('Cambia el tamaño de la etiqueta…', 2500);
await page.locator('#size').selectOption('80x50');
await shot('11-size');
await page.waitForTimeout(1200);
await page.locator('#size').selectOption('100x60');
await caption('…gira la vista previa…', 2500);
await page.locator('#rotation').selectOption('90');
await page.waitForTimeout(1800);
await page.locator('#rotation').selectOption('0');
await caption('…y activa o desactiva la rejilla y las marcas de solapamiento', 3500);
await page.locator('#optGrid').uncheck();
await page.waitForTimeout(1200);
await page.locator('#optGrid').check();

// 9. Convert between languages
await show('Convertir a…');
await caption('«Convertir a…» traduce tu etiqueta a otro lenguaje de impresora', 3500);
const target = page.locator('select:has(option[value="zpl"])').first();
await target.selectOption('zpl');
await page.getByRole('button', { name: 'Convertir', exact: true }).click();
await caption('Aquí tienes el resultado en ZPL (Zebra). Puedes copiarlo o descargarlo', 4500);
await shot('12-convert-zpl');
await target.selectOption('tspl');
await page.getByRole('button', { name: 'Convertir', exact: true }).click();
await caption('Y aquí en TSPL (TSC). Los avisos te dicen qué puede cambiar al traducir', 4500);
await shot('13-convert-tspl');

// 10. Ready-made templates
await show('Código de etiqueta');
await caption('Hay plantillas listas para TPCL, TSPL y ZPL, incluida la etiqueta GS1-128', 4000);
await page.locator('#example').selectOption('template-gs1-zpl');
await page.waitForTimeout(1800);
await shot('14-gs1');

// 11. Print
await show('Impresión');
await page.getByRole('button', { name: 'Reintentar' }).click().catch(() => {});
await page.waitForTimeout(1200);
await caption('En «Impresión» eliges la impresora y las copias (demo con impresora simulada)', 4500);
await shot('15-print');
await page.getByRole('button', { name: 'Imprimir', exact: true }).click();
await caption('Modo «Etiquetera»: el código sale directo a la etiquetera', 4000);
await shot('16-printed');
await page.locator('select:has(option[value="image"])').first().selectOption('image');
await page.waitForTimeout(800);
await caption('Modo «Driver imagen»: imprime la etiqueta como imagen en cualquier impresora de Windows', 5000);
await shot('17-image-mode');

await caption('Eso es todo. ¡Prueba PrintBridge!', 3500);
await hideCaption();
await page.waitForTimeout(500);

const videoPath = await page.video().path();
await context.close();
await browser.close();
renameSync(videoPath, join(out, 'printbridge-demo.webm'));
console.log('Video: ' + join(out, 'printbridge-demo.webm'));
