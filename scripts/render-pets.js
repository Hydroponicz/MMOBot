// Renders every pet (public/pet3d.js) to public/pets/<id>.png, so the site can show pets as pictures
// on any device. Run after changing a pet: npm start in another terminal, then
//   npm run render-pets [-- http://localhost:3000]
// Needs Playwright with Chromium (WebGL through SwiftShader works headless).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SIZE = 256;
const base = process.argv[2] || 'http://localhost:3000';
const out = path.join(__dirname, '..', 'public', 'pets');

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto(base); // the home page has the import map for three.js
  const pets = await page.evaluate(async (size) => {
    const m = await import('/pet3d.js');
    return m.PET_IDS.map((id) => [id, m.renderPet(id, size)?.toDataURL('image/png')]);
  }, SIZE);
  fs.mkdirSync(out, { recursive: true });
  for (const [id, url] of pets) {
    if (!url) throw new Error(`${id} did not render (no WebGL?)`);
    fs.writeFileSync(path.join(out, `${id}.png`), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log(`wrote ${pets.length} pets to ${out}`);
  await browser.close();
})();
