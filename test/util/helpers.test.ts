import test from 'node:test';
import assert from 'node:assert/strict';
import { foldCommandPreview } from '../../src/util/helpers.js';

test('foldCommandPreview truncates long multi-line content', () => {
  const text = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');
  assert.equal(foldCommandPreview(text, { maxLines: 3 }), 'line1\nline2\nline3\n...');
});
