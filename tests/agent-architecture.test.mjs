// Agent architecture lens: floorplan/agent-architecture.json, written by the AI agent, is checked at build time and
// shown in the AI menu. It must stay generic (nothing app-specific in the viewer), drop what isn't on the map, and
// do nothing at all for an app without AI or without the file.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SKILL, lib, makeProject, scanAndBuild, readGraph, writeJson, cleanup } from './helpers.mjs';

const { readAgentArchitecture } = await lib('agent-architecture.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'floorplan-aa-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function read(data, onMap = ['f:api/chat.js', 'n:openai']) {
  const file = path.join(tmp, 'agent-architecture.json');
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  const warnings = [];
  const out = readAgentArchitecture({ file, resolve: (r) => (onMap.includes(r) ? r : null), warn: (m) => warnings.push(m) });
  return { out, warnings };
}
const stage = (id, extra = {}) => ({ id, label: id, status: 'present', summary: `About ${id}.`, ...extra });

test('a missing file is nothing, and a broken one is a warning, not a crash', () => {
  assert.equal(readAgentArchitecture({ file: path.join(tmp, 'nope.json'), resolve: () => null, warn: () => {} }), null);
  const r = read('{ not json');
  assert.equal(r.out, null);
  assert.match(r.warnings[0], /not valid JSON/);
  assert.equal(read({ flow: { stages: [] } }).out, null);
});

test('stages are checked: unknown ids, missing summaries and bad statuses', () => {
  const { out, warnings } = read({ verdict: 'One agent.', flow: { stages: [
    stage('perception', { refs: ['f:api/chat.js', 'f:gone.js'] }),
    stage('made-up'),
    { id: 'reasoning', status: 'present' },
    stage('action', { status: 'sort of' }),
    stage('perception', { summary: 'a duplicate' }),
  ] } });
  assert.deepEqual(out.flow.stages.map((s) => s.id), ['perception', 'action']);
  assert.deepEqual(out.flow.stages[0].refs, ['f:api/chat.js'], 'a ref that is not on the map is dropped');
  assert.equal(out.flow.stages[0].summary, 'About perception.', 'the first of a duplicated stage wins');
  assert.equal(out.flow.stages[1].status, 'partial');
  const all = warnings.join('\n');
  assert.match(all, /unknown id "made-up"/);
  assert.match(all, /"reasoning" needs a summary/);
  assert.match(all, /status must be present, partial or absent/);
  assert.match(all, /1 ref\(s\) aren't on the map/);
});

test('the concurrent part, readers and lists are optional and trimmed', () => {
  const { out } = read({ flow: { stages: [stage('perception')] },
    concurrent: { trigger: 'A click', stages: [stage('readers')], readers: [{ label: 'Plot', ref: 'f:api/chat.js' }, { label: 'Lost', ref: 'f:gone.js' }, { ref: 'f:api/chat.js' }],
      controls: { items: [{ text: 'One at a time.', ref: 'n:openai' }, { text: '' }] } },
    gaps: { items: ['Something to know', '', 7] } });
  assert.equal(out.concurrent.trigger, 'A click');
  assert.deepEqual(out.concurrent.readers.map((r) => r.label), ['Plot']);
  assert.equal(out.concurrent.controls.items.length, 1);
  assert.equal(out.concurrent.controls.title, 'How overlapping work is kept safe');
  assert.deepEqual(out.gaps.items, ['Something to know']);
  assert.equal(read({ flow: { stages: [stage('perception')] } }).out.concurrent, undefined);
});

const files = {
  'api/chat.js': "// chat prompt for the assistant model\nasync function ask(q) { return fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: q }] }) }); }\nmodule.exports = { ask };\n",
};
const arch = { project: { name: 'aa-fixture', summary: 'Test fixture.' }, nodes: [
  { id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] },
  { id: 'openai', label: 'OpenAI', kind: 'external', summary: 'Writes text.', hosts: ['api.openai.com'] },
] };
const doc = { title: 'How the AI works', verdict: 'One call per message.', flow: { stages: [stage('perception', { refs: ['f:api/chat.js'] }), stage('environment', { refs: ['n:openai', 'n:nowhere'] })] } };

test('a build carries the file into graph.ai, drops stale refs, and the viewer is inlined', () => {
  const root = makeProject(files, { arch });
  try {
    writeJson(path.join(root, 'floorplan', 'agent-architecture.json'), doc);
    const out = scanAndBuild(root);
    const g = readGraph(root);
    assert.equal(g.ai.agentArchitecture.title, 'How the AI works');
    assert.deepEqual(g.ai.agentArchitecture.flow.stages[1].refs, ['n:openai']);
    assert.match(out, /agent flow/);
    const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
    assert.ok(html.includes('ui/37-agent-architecture.js'), 'the viewer extension is inlined into the map');
  } finally { cleanup(root); }
});

test('without the file, or without AI, nothing is added', () => {
  const none = makeProject(files, { arch });
  const plain = makeProject({ 'api/x.js': 'exports.x = 1;\n' }, { arch: { project: { name: 'p', summary: 's' }, nodes: [{ id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] }] } });
  try {
    scanAndBuild(none);
    assert.equal(readGraph(none).ai.agentArchitecture, undefined);
    writeJson(path.join(plain, 'floorplan', 'agent-architecture.json'), doc);
    scanAndBuild(plain);
    assert.equal(readGraph(plain).ai, undefined, 'an app that does not use AI gets no AI layer, file or not');
  } finally { cleanup(none); cleanup(plain); }
});

test('the viewer extension stays generic', () => {
  const src = fs.readFileSync(path.join(SKILL, 'assets', 'ui', '37-agent-architecture.js'), 'utf8');
  assert.doesNotMatch(src, /Storymatic|manuscript|author|FLOORPLAN_AGENT/i);
  assert.match(src, /graph\.ai\.agentArchitecture/);
});
