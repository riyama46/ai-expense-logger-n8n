// A scrolling screenshot: Telegram shrinks the long side to 1280 px, so the longer the capture, the
// smaller the text. Seen live with a BCA activity list: 14 rows at ratio 4.7 (about 270 px wide) were
// all read, about 21 rows at ratio 6.7 (about 190 px wide) came back as 3 made-up rows.
const IMAGE_MAX_RATIO = 5;

// {width, height} from the JPEG frame header, or null when the data is not a readable JPEG
function imageJpegSize(base64) {
  const b = Buffer.from(String(base64 || ''), 'base64');
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // SOF0..SOF15 hold the size; C4 (huffman), C8 (reserved) and CC (arithmetic) are not frames
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

function imageTooLong(size) {
  return !!size && size.width > 0 && size.height / size.width > IMAGE_MAX_RATIO;
}

if (typeof module !== 'undefined') module.exports = { imageJpegSize, imageTooLong };
