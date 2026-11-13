const fs = require('fs');
const path = require('path');
const qaRoot = path.join(__dirname, '..');
const input = path.join(qaRoot, 'test-results', 'results.json');
const output = path.join(qaRoot, '..', 'AUDIT-REPORT.md');
if (!fs.existsSync(input)) {
  fs.writeFileSync(output, '# Ronyal POS QA execution report\n\nNo Playwright JSON report was produced. Check workflow logs for setup or startup failure.\n');
  process.exit(0);
}
const report = JSON.parse(fs.readFileSync(input, 'utf8'));
const tests = [];
function walk(suite, parents = []) {
  for (const spec of suite.specs || []) for (const item of spec.tests || []) {
    const result = item.results && item.results[item.results.length - 1] || {};
    tests.push({
      title: [...parents, spec.title].filter(Boolean).join(' › '),
      status: item.status || result.status || 'unknown',
      duration: result.duration || 0,
      error: result.error && (result.error.message || result.error.stack) || ''
    });
  }
  for (const child of suite.suites || []) walk(child, [...parents, child.title].filter(Boolean));
}
for (const suite of report.suites || []) walk(suite);
const counts = {};
for (const item of tests) counts[item.status] = (counts[item.status] || 0) + 1;
const lines = [
  '# Ronyal POS QA execution report', '',
  '- Generated: ' + new Date().toISOString(),
  '- Total tests: ' + tests.length,
  '- Passed: ' + (counts.passed || 0),
  '- Failed: ' + (counts.failed || 0),
  '- Expected failures: ' + (counts.expected || 0),
  '- Timed out: ' + (counts.timedOut || 0),
  '- Skipped: ' + (counts.skipped || 0),
  '', '| Test | Result | Duration |', '|---|---:|---:|'
];
for (const item of tests) lines.push('| ' + item.title.replace(/\|/g, '\\|') + ' | ' + item.status + ' | ' + (item.duration / 1000).toFixed(2) + 's |');
const failures = tests.filter(item => ['failed', 'timedOut', 'interrupted'].includes(item.status));
if (failures.length) {
  lines.push('', '## Failure details', '');
  for (const item of failures) lines.push('### ' + item.title, '', '<pre>', item.error || 'No error detail supplied.', '</pre>', '');
}
lines.push('', '## Interpretation and limits', '',
  '- Tests run in isolated Playwright browser contexts with seeded IndexedDB data; no live store Sync ID is loaded.',
  '- A passing test proves only its named assertions, not every possible workflow.',
  '- Offline tests verify local browser persistence only; they do not prove Firestore queue replay, conflict handling or multi-device convergence.',
  '- Native print adapter tests use a mock bridge. They do not prove Android PrintManager output or physical 58/88mm paper alignment.',
  '- Areas without executed tests remain unverified. Review qa/COVERAGE-MATRIX.md and qa/AUDIT-PROMPT.md.',
  '');
fs.writeFileSync(output, lines.join('\n'));
