// Rewrites the shared .logo CSS + font link in every artboard so all screens carry the real Hurbad logo.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'artboards';
const OLD_FONT = 'family=DM+Sans:wght@400;500;600&';
const NEW_FONT = 'family=DM+Sans:wght@300;400;500;600;700&';
const oldRules = [
  /\.logo\{display:flex;align-items:center;gap:10px;font-family:var\(--fd\);font-weight:500;font-size:20px;letter-spacing:-\.5px\}\s*/,
  /\.logo \.mk\{width:22px;height:22px;display:grid;grid-template-columns:5px 12px 5px;align-items:center\}\s*/,
  /\.logo \.mk i\{display:block;height:22px;background:currentColor;border-radius:1\.5px\}\s*/,
  /\.logo \.mk b\{display:block;height:6px;background:var\(--p\)\}\s*/,
  /\.logo span\{font-family:var\(--fb\);font-weight:400;color:var\(--ink2\)\}\s*/,
  /\.logo \.sq\{[^}]*\}\s*/,
];
const NEW_RULES = `.logo{display:flex;align-items:center;gap:10px;font-family:var(--fb);font-weight:700;font-size:17px;letter-spacing:.6px;text-transform:uppercase;color:var(--p);line-height:1}
  .logo .mk{width:32px;height:32px;border-radius:7px;background:var(--p);display:grid;grid-template-columns:4px 9px 4px;align-items:center;justify-content:center;flex:none}
  .logo .mk i{display:block;height:20px;background:#fff;border-radius:1px}
  .logo .mk b{display:block;height:4px;background:#fff}
  .logo span{font-weight:300;color:var(--ink);letter-spacing:2.6px;font-size:12px;margin-left:2px}
  `;
let touched = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const p = `${dir}/${f}`;
  let s = readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(OLD_FONT, NEW_FONT);
  let replaced = false;
  for (const re of oldRules) {
    if (re.test(s)) {
      s = s.replace(re, replaced ? '' : NEW_RULES);
      replaced = true;
    }
  }
  // dark headers: keep HURBAD orange, HARDWARE cream
  s = s.replace(/class="logo" style="color:#f7f5f0"/g, 'class="logo"');
  s = s.replace(
    /(<div class="mk"><i><\/i><b><\/b><i><\/i><\/div>Hurbad <span style=")color:#b9b6ad(">Hardware<\/span>)/g,
    '$1color:#f7f5f0$2',
  );
  if (s !== before) {
    writeFileSync(p, s);
    touched++;
  }
}
console.log(`patched ${touched} artboards in ${dir}`);
