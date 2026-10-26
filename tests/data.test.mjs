import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

test('bundled CSV preserves the Kaggle source bytes and JSON records', async () => {
  const raw = await readFile(new URL('../data/ibm-hr-attrition.csv', import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), 'a5c31e38bd7fafc9bc333884eb181b06b41b8e5e488e8f7ccb27199fb3be7659');
  const lines = raw.toString('utf8').trim().split(/\r?\n/);
  const fields = lines.shift().split(',');
  const rows = JSON.parse(await readFile(new URL('../data/ibm-hr-attrition.json', import.meta.url), 'utf8'));
  assert.equal(fields.length, 35);
  assert.equal(rows.length, 1470);
  assert.equal(new Set(rows.map(row => row.EmployeeNumber)).size, 1470);
  assert.equal(rows.filter(row => row.Attrition === 'Yes').length, 237);
  lines.forEach((line, i) => line.split(',').forEach((value, j) => {
    assert.notEqual(value, '');
    assert.equal(String(rows[i][fields[j]]), value);
  }));
  const overtime = rows.filter(row => row.OverTime === 'Yes');
  assert.equal(overtime.length, 416);
  assert.equal(overtime.filter(row => row.Attrition === 'Yes').length, 127);
  const hr = rows.filter(row => row.Department === 'Human Resources');
  assert.equal(hr.length, 63);
  assert.equal(hr.filter(row => row.Attrition === 'Yes').length, 12);
});
