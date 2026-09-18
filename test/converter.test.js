'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { htmlToMarkdown } = require('../src/converter.js');

test('tokenizer ignores > inside quoted attributes (raw code leak)', () => {
  const html =
    '<div class="relative">' +
    '<button data-code="<EventData> <Data Name=\'RuleName\'>-</Data>" aria-label="Copy code"></button>' +
    '<pre><code class="language-xml">&lt;EventData&gt;real&lt;/EventData&gt;</code></pre>' +
    '</div>';
  const md = htmlToMarkdown(html);
  assert.match(md, /```xml/);
  assert.match(md, /<EventData>real<\/EventData>/);
  assert.doesNotMatch(md, /aria-label|Copy code|data-code/);
});

test('does not emit raw HTML for a <pre> without <code>', () => {
  const md = htmlToMarkdown('<pre>plain   code</pre>');
  assert.match(md, /```\nplain {3}code\n```/);
});

test('flattens nested anchors instead of emitting broken link syntax', () => {
  const md = htmlToMarkdown('<a href="https://outer.example"><a href="https://inner.example">inner</a></a>');
  assert.doesNotMatch(md, /\]\([^)]*\)\]\(/);
  assert.match(md, /inner/);
});

test('does not wrap an anchor that already contains an image', () => {
  const md = htmlToMarkdown('<a href="https://outer.example"><img src="https://img.example/a.png" alt="pic"> caption</a>');
  assert.doesNotMatch(md, /\]\([^)]*\)\]\(/);
  assert.match(md, /!\[pic\]\(https:\/\/img\.example\/a\.png\)/);
});

test('decodes entities inside href', () => {
  const md = htmlToMarkdown('<a href="https://x.example/?a=1&amp;b=2">link</a>');
  assert.match(md, /\(https:\/\/x\.example\/\?a=1&b=2\)/);
});

test('sanitizes a literal alt="None"', () => {
  const md = htmlToMarkdown('<img src="https://x.example/a.png" alt="None">');
  assert.equal(md, '![](https://x.example/a.png)');
});
