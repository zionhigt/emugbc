import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/**
 * UN DÉCODEUR PNG MINIMAL, pour lire les images de référence des ROMs acid2.
 *
 * Aucune dépendance : `zlib` est dans Node, et le reste d'un PNG tient en peu de
 * choses une fois qu'on sait ce qu'on lit. On ne vise QUE le format que ces
 * images utilisent — palette, non entrelacé — et on refuse bruyamment le reste
 * plutôt que de rendre des pixels faux en silence. Une image de référence qu'on
 * décode de travers est pire que pas d'image du tout : elle transforme un
 * émulateur juste en émulateur rouge, et on cherche le bug au mauvais endroit.
 *
 * Le désentrelacement des filtres suit la spec (§9.2) : chaque ligne porte un
 * octet de filtre, et se reconstruit à partir du voisin de gauche (a), de celui
 * du dessus (b) et du diagonal (c).
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const PALETTE_COLOR_TYPE = 3;

/** @returns {{ width, height, palette: Array<[r,g,b]>, indices: Uint8Array }} */
export function decodePalettePng(path) {
  const data = readFileSync(path);
  if (SIGNATURE.some((octet, i) => data[i] !== octet)) {
    throw new Error(`${path} : ce n'est pas un PNG`);
  }

  let header = null;
  let palette = null;
  const chunks = [];

  for (let i = 8; i < data.length; ) {
    const length = data.readUInt32BE(i);
    const type = data.toString('ascii', i + 4, i + 8);
    const body = data.subarray(i + 8, i + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') {
      palette = body;
    } else if (type === 'IDAT') {
      chunks.push(body);
    } else if (type === 'IEND') {
      break;
    }
    i += 12 + length;
  }

  if (!header) throw new Error(`${path} : IHDR manquant`);
  if (header.colorType !== PALETTE_COLOR_TYPE || !palette) {
    throw new Error(`${path} : seules les images à palette sont lues (type ${header.colorType})`);
  }
  if (header.interlace !== 0) {
    throw new Error(`${path} : les images entrelacées ne sont pas lues`);
  }
  if (![1, 2, 4, 8].includes(header.depth)) {
    throw new Error(`${path} : profondeur ${header.depth} non lue`);
  }

  const { width, height, depth } = header;
  const raw = inflateSync(Buffer.concat(chunks));
  const rowBytes = Math.ceil((width * depth) / 8);
  const indices = new Uint8Array(width * height);

  // Sous 8 bits par pixel, le voisin « de gauche » de la spec reste l'OCTET
  // précédent, pas le pixel précédent : bpp est plafonné à 1.
  const bpp = Math.max(1, depth >> 3);

  let previous = new Uint8Array(rowBytes);
  let offset = 0;

  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const row = Uint8Array.prototype.slice.call(raw, offset, offset + rowBytes);
    offset += rowBytes;

    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
      switch (filter) {
        case 0: break;                                   // aucun
        case 1: row[x] = (row[x] + a) & 0xff; break;     // gauche
        case 2: row[x] = (row[x] + b) & 0xff; break;     // dessus
        case 3: row[x] = (row[x] + ((a + b) >> 1)) & 0xff; break; // moyenne
        case 4: {                                        // Paeth
          const estimate = a + b - c;
          const da = Math.abs(estimate - a);
          const db = Math.abs(estimate - b);
          const dc = Math.abs(estimate - c);
          const nearest = da <= db && da <= dc ? a : db <= dc ? b : c;
          row[x] = (row[x] + nearest) & 0xff;
          break;
        }
        default: throw new Error(`${path} : filtre ${filter} inconnu ligne ${y}`);
      }
    }

    const perByte = 8 / depth;
    const mask = (1 << depth) - 1;
    for (let x = 0; x < width; x++) {
      const shift = 8 - depth * ((x % perByte) + 1);
      indices[y * width + x] = (row[(x / perByte) | 0] >> shift) & mask;
    }
    previous = row;
  }

  const colors = [];
  for (let k = 0; k < palette.length; k += 3) {
    colors.push([palette[k], palette[k + 1], palette[k + 2]]);
  }

  return { width, height, palette: colors, indices };
}

/**
 * L'image de référence, ramenée à ce que le PPU produit : du RGB555, une couleur
 * par pixel. Les images acid2 sont issues d'un vrai CGB, donc leurs octets sont
 * déjà des composantes 5 bits étendues à 8 — le retour se fait sans perte.
 */
export function toRgb555(path) {
  const { width, height, palette, indices } = decodePalettePng(path);
  const colors = palette.map(([r, g, b]) => ((b >> 3) << 10) | ((g >> 3) << 5) | (r >> 3));
  const pixels = new Uint16Array(indices.length);
  for (let i = 0; i < indices.length; i++) pixels[i] = colors[indices[i]];
  return { width, height, pixels };
}

/** Combien de pixels diffèrent, et où se trouve le premier écart. */
export function comparePixels(got, expected, width = 160) {
  let wrong = 0;
  let first = null;
  for (let i = 0; i < expected.length; i++) {
    if (got[i] === expected[i]) continue;
    wrong++;
    if (!first) first = { x: i % width, y: (i / width) | 0, got: got[i], expected: expected[i] };
  }
  return { wrong, total: expected.length, first };
}
