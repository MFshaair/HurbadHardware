// Assembles design/canvas.json from the per-area *.layout.json manifests.
// Pages: Brand & System sheet, then one page per area. Rows wrap at ~4800px; 120px between rows, 80px between frames.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const A = 'artboards';
const pages = [
  {
    id: 'brand',
    name: 'Brand & design system',
    boards: [
      { file: 'BrandIdentity.dc.html', w: 1440, h: 1500 },
      { file: 'DesignSystem.dc.html', w: 1440, h: 1500 },
    ],
  },
  {
    id: 'storefront',
    name: '1 · Storefront',
    manifest: 'Storefront.layout.json',
    lead: { file: 'Main.dc.html', w: 1440, h: 3400, title: 'Home' },
  },
  { id: 'auth', name: '2 · Auth', manifest: 'Auth.layout.json' },
  { id: 'account', name: '3 · Customer account', manifest: 'Account.layout.json' },
  { id: 'admin', name: '4 · Admin', manifest: 'Admin.layout.json' },
  { id: 'system', name: '5 · System states & templates', manifest: 'System.layout.json' },
];
const artboards = [];
const annotations = [];
const GAP_X = 80,
  GAP_Y = 120,
  MAX_W = 4800;
for (const p of pages) {
  let boards = p.boards ?? [];
  if (p.manifest) {
    const path = `${A}/${p.manifest}`;
    if (!existsSync(path)) {
      console.error(`missing ${path}`);
      continue;
    }
    boards = JSON.parse(readFileSync(path, 'utf8'));
    if (p.lead) boards = [p.lead, ...boards];
  }
  let x = 0,
    y = 0,
    rowH = 0;
  for (const b of boards) {
    if (x > 0 && x + b.w > MAX_W) {
      x = 0;
      y += rowH + GAP_Y;
      rowH = 0;
    }
    const entry = { file: b.file, x, y, w: b.w, h: b.h, page: p.id };
    if (b.title) entry.title = b.title;
    artboards.push(entry);
    x += b.w + GAP_X;
    rowH = Math.max(rowH, b.h);
  }
  annotations.push({
    id: `note-${p.id}`,
    x: 0,
    y: -140,
    w: 520,
    page: p.id,
    text: `${p.name}\nHurbad Hardware · static hi-fi mockups · desktop 1440 / mobile 390. Tokens in design/DESIGN.md.`,
  });
}
const canvas = {
  pages: pages.map((p) => ({ id: p.id, name: p.name })),
  artboards,
  annotations,
  launch: { view: 'canvas', page: 'storefront' },
};
writeFileSync('canvas.json', JSON.stringify(canvas, null, 2));
console.log(`canvas.json: ${artboards.length} artboards on ${pages.length} pages`);
