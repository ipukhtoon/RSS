const fs = require('node:fs');
const path = require('node:path');
const pngToIco = require('png-to-ico');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

(async () => {
  const root = path.resolve(__dirname, '..');

  // Windows app branding uses the original store logo, never the receipt artwork.
  const sourcePath = path.join(root, 'ronyal-logo.png');
  if (!fs.existsSync(sourcePath)) {
    throw new Error('Missing ronyal-logo.png (original brand logo). Refusing to substitute the receipt logo.');
  }

  const source = fs.readFileSync(sourcePath);
  if (source.length < 33 || !source.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('ronyal-logo.png is empty or is not a valid PNG image.');
  }

  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (!width || !height) {
    throw new Error('ronyal-logo.png has invalid image dimensions.');
  }

  const ico = await pngToIco(source);
  if (!Buffer.isBuffer(ico) || ico.length < 22 ||
      ico.readUInt16LE(0) !== 0 ||
      ico.readUInt16LE(2) !== 1 ||
      ico.readUInt16LE(4) < 1) {
    throw new Error('Windows icon conversion did not produce a valid ICO file.');
  }

  fs.writeFileSync(path.join(root, 'icon.ico'), ico);
  console.log('Verified icon.ico (' + ico.readUInt16LE(4) +
    ' image(s)) generated from ronyal-logo.png (' + width + 'x' + height + ').');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
