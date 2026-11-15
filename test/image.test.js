const test = require('node:test');
const assert = require('node:assert');
const { imageJpegSize, imageTooLong } = require('../n8n/code/image.js');
const { jpeg } = require('./sample.test.js');

test('imageJpegSize: baseline and progressive frames, null for anything else', () => {
  assert.deepEqual(imageJpegSize(jpeg(576, 1280)), { width: 576, height: 1280 });
  assert.deepEqual(imageJpegSize(jpeg(270, 1280, 0xc2)), { width: 270, height: 1280 });
  assert.equal(imageJpegSize(''), null);
  assert.equal(imageJpegSize(Buffer.from('not a jpeg at all').toString('base64')), null);
});

test('imageTooLong: only a scrolling screenshot', () => {
  assert.equal(imageTooLong({ width: 190, height: 1280 }), true); // about 21 rows of a BCA activity list: unreadable
  assert.equal(imageTooLong({ width: 270, height: 1280 }), false); // 14 rows: read correctly
  assert.equal(imageTooLong({ width: 576, height: 1280 }), false); // 9:20 phone screen
  assert.equal(imageTooLong({ width: 548, height: 1280 }), false); // 9:21 phone screen
  assert.equal(imageTooLong({ width: 1280, height: 960 }), false); // receipt photo, landscape
  assert.equal(imageTooLong(null), false); // unknown size: let the model try
});
