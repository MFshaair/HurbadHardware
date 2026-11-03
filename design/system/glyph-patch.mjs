import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const STAR =
  '<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:currentColor;stroke:none;vertical-align:-1px;display:inline-block"><path d="m12 2 3 6.6 7 .8-5.2 4.8 1.4 7L12 17.7 5.8 21.2l1.4-7L2 9.4l7-.8z"></path></svg>';
const ARROW =
  '<svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;vertical-align:-2px;display:inline-block;margin-left:2px"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>';
let n = 0;
for (const f of readdirSync('artboards').filter((f) => f.endsWith('.dc.html'))) {
  const p = `artboards/${f}`;
  const s = readFileSync(p, 'utf8');
  const t = s.replace(/★ ?/g, STAR + ' ').replace(/ ?→/g, ' ' + ARROW);
  if (t !== s) {
    writeFileSync(p, t);
    n++;
  }
}
console.log('glyph-patched', n);
