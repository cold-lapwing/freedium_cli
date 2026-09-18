'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { pick } = require('../src/picker.js');

function harness(columns = 80, rows = 24) {
  let buffer = '';
  const output = {
    columns,
    rows,
    isTTY: true,
    write(chunk) {
      buffer += chunk;
    },
    get text() {
      return buffer.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    },
  };
  const input = new EventEmitter();
  input.setRawMode = () => {};
  input.resume = () => {};
  input.pause = () => {};
  input.setEncoding = () => {};
  return { output, input, get text() { return output.text; } };
}

const items = [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }];

test('renders a > marker on the first item', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input, header: 'Pick' });
  assert.match(h.text, />\s+1\. One/);
  h.input.emit('data', '\r');
  assert.equal(await promise, 0);
});

test('down arrow moves the marker and selection', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', '\x1b[B');
  h.input.emit('data', '\x1b[B');
  assert.match(h.text, />\s+3\. Three/);
  h.input.emit('data', '\r');
  assert.equal(await promise, 2);
});

test('up arrow wraps nothing and stays at the top', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', '\x1b[A');
  h.input.emit('data', '\r');
  assert.equal(await promise, 0);
});

test('j/k vim keys move the selection', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', 'jj');
  h.input.emit('data', 'k');
  h.input.emit('data', '\r');
  assert.equal(await promise, 1);
});

test('q cancels and resolves null', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', 'q');
  assert.equal(await promise, null);
});

test('ctrl-c cancels and resolves null', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', '\x03');
  assert.equal(await promise, null);
});

test('end key jumps to the last item', async () => {
  const h = harness();
  const promise = pick(items, { output: h.output, input: h.input });
  h.input.emit('data', '\x1b[F');
  h.input.emit('data', '\r');
  assert.equal(await promise, 3);
});
