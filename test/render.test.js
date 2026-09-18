'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Renderer } = require('../src/render.js');

function plain(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

test('formats markdown inside link text', () => {
  const r = new Renderer({ color: false, width: 200, image: 'text' });
  const out = plain(r.formatInline('[**Bold** and *italic*](https://x.example)'));
  assert.match(out, /Bold and italic/);
  assert.doesNotMatch(out, /\*\*/);
  assert.doesNotMatch(out, /\]\(/);
});

test('handles an image wrapped in a link without leaking brackets', () => {
  const r = new Renderer({ color: false, width: 200, image: 'text' });
  const out = plain(r.formatInline('[![alt text](https://img.example/a.png)](https://x.example)'));
  assert.match(out, /\[image: alt text\]/);
  assert.doesNotMatch(out, /\]\(/);
});

test('renders bold that appears before a link on the same line', () => {
  const r = new Renderer({ color: false, width: 200, image: 'text' });
  const out = plain(r.formatInline('**lead in** then [a link](https://x.example)'));
  assert.match(out, /lead in then a link/);
  assert.doesNotMatch(out, /\*\*/);
});
