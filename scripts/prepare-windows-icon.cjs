const fs = require('node:fs');
const path = require('node:path');
const pngToIco = require('png-to-ico');

(async () => {
  const root = path.resolve(__dirname, '..');
  const candidates = ['ronyal-logo-receipt.png', 'ronyal-logo.png'];
  let source = null;

  for (const name of candidates) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
      source = { file, bytes };
      break;
    }
  }

  if (!source) throw new Error('No valid Ronyal PNG logo found. Check ronyal-logo.png and ronyal-logo-receipt.png.');
  const ico = await pngToIco(source.bytes);
  fs.writeFileSync(path.join(root, 'icon.ico'), ico);
  console.log('Prepared Windows application icon from ' + path.basename(source.file));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
