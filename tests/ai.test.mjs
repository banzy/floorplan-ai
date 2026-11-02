// AI lens: finding where an app uses AI, what it sends, what checks and limits it, and the boards and
// flow built from that. Also what must NOT count: an app with no AI, or ordinary words like "safety".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SKILL, lib, makeProject, scanAndBuild, readGraph, cleanup } from './helpers.mjs';

const { findAi } = await lib('ai.mjs');
const code = (p, lang = 'typescript') => ({ path: p, category: 'code', lang });

const arch = (nodes) => ({ project: { name: 'ai-fixture', summary: 'Test fixture.' }, nodes });
const NODES = [
  { id: 'web', label: 'Website', kind: 'ui', summary: 'The website.', paths: ['web/**'] },
  { id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] },
  { id: 'openai', label: 'OpenAI', kind: 'external', summary: 'Writes text.', hosts: ['api.openai.com'] },
];

test('findAi reads a file\'s job from its text, not from one stray word', () => {
  const prompt = findAi('const messages = [{ role: "system", content: "You are a careful editor." }]; // chat model prompt', code('a.ts'));
  assert.deepEqual(prompt.roles, ['prompt']);
  // the word "safety" alone, or "usage" alone, is not enough
  assert.equal(findAi('// safety first\nexport const x = 1;', code('b.ts')), null);
  assert.equal(findAi('export const usage = 1; // token usage in the chat window', code('c.ts'))?.roles?.includes('meter') ?? false, false);
  // several safety words in a file that talks about models and prompts is a guard
  const guard = findAi('// moderation of the model prompt: refuse harmful requests, a blocklist and a safety check\nfunction check(prompt) {}', code('check.ts'));
  assert.ok(guard.roles.includes('guard'));
  // a model id names its maker; a file named for a provider is hinted too
  assert.deepEqual(findAi('const model = "claude-sonnet-4-5"; // chat model', code('x.ts')).providers, ['anthropic']);
  assert.deepEqual(findAi('// chat model prompt\nfunction send() {}\nconst path = "/chat/completions";', code('ElevenLabsClient.php', 'php')).providers, ['elevenlabs']);
  // a request path with no host (a configured base URL) still counts as a call
  assert.ok(findAi('$this->post("/chat/completions", $body); // model', code('Client.php', 'php')).roles.includes('call'));
  // non-code files are never read
  assert.equal(findAi('You are a helper', { path: 'README.md', category: 'docs', lang: 'markdown' }), null);
});

let root, graph;
before(() => {
  root = makeProject({
    'web/src/ChatScreen.tsx': "import { askAssistant } from './client';\nexport default function ChatScreen() { return askAssistant('hi'); }\n",
    'web/src/client.ts': "export async function askAssistant(q: string) {\n  // chat prompt for the assistant model, streamed\n  const res = await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ q, stream: true }), headers: { accept: 'text/event-stream' } });\n  return res.body.getReader();\n}\n",
    'web/src/prompts.ts': "// Instructions for the assistant model\nexport const SYSTEM_PROMPT = 'You are a careful editor. Answer the chat prompt briefly.';\nexport const messages = (q: string) => [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: q }];\n",
    'api/src/chat.js': "const { complete } = require('./openai');\nconst { check } = require('./safety');\nconst { hold, charge } = require('./credit');\nmodule.exports = async (req, res) => { check(req.body.q); hold(); const r = await complete(req.body.q); charge(r.usage); res.end(r.text); };\n",
    'api/src/openai.js': "async function complete(q) {\n  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: q }] }) });\n  return r.json();\n}\nmodule.exports = { complete };\n",
    'api/src/safety.js': "// Safety check for the chat model prompt: moderation, a blocklist, and refusing harmful or jailbreak requests.\nexports.check = (q) => { if (/jailbreak/.test(q)) throw new Error('decline'); };\n",
    'api/src/credit.js': "// Credit for each chat model call: token usage is priced in usd against the user's budget and quota.\nexports.hold = () => {}; exports.charge = (usage) => { const cost = usage.total_tokens * 0.000002; return cost; };\n",
    // ordinary code that happens to use the same everyday words
    'api/src/billing.js': "// invoice cost and price for the shop\nexports.total = (items) => items.reduce((s, i) => s + i.price, 0);\n",
  }, { arch: arch(NODES) });
  scanAndBuild(root);
  graph = readGraph(root);
});
after(() => cleanup(root));

const ids = (list) => list.map((f) => f.id.replace(/^f:/, '')).sort();

test('the files that make up the AI layer are found, with their jobs', () => {
  assert.ok(graph.ai, 'graph.ai exists when the app calls an AI service');
  const by = Object.fromEntries(graph.ai.files.map((f) => [f.id.replace(/^f:/, ''), f.roles]));
  assert.ok(by['api/src/openai.js'].includes('call'));
  assert.ok(by['web/src/prompts.ts'].includes('prompt'));
  assert.ok(by['api/src/safety.js'].includes('guard'));
  assert.ok(by['api/src/credit.js'].includes('meter'));
  assert.ok(by['web/src/client.ts'].includes('stream'));
});

test('ordinary code with words like "cost" and "price" is left out', () => {
  assert.ok(!ids(graph.ai.files).includes('api/src/billing.js'));
  assert.ok(!ids(graph.ai.files).includes('web/src/ChatScreen.tsx'));
});

test('the provider is named and tied to its outside-service node', () => {
  assert.deepEqual(graph.ai.providers.map((p) => p.label), ['OpenAI']);
  assert.deepEqual(graph.ai.providers[0].nodes, ['openai']);
});

test('boards answer: where is AI used, what is sent, what limits it, who does it talk to', () => {
  const board = (id) => graph.ai.boards.find((b) => b.id === id);
  assert.ok(board('ai:overview').items.some((i) => i.id === 'n:openai'), 'the overview includes the outside service');
  assert.deepEqual(board('ai:prompts').items.map((i) => i.id), ['f:web/src/prompts.ts']);
  const limits = board('ai:limits').items.map((i) => i.id);
  assert.ok(limits.includes('f:api/src/safety.js') && limits.includes('f:api/src/credit.js'));
  assert.ok(board('ai:provider:openai').items.some((i) => i.id === 'f:api/src/openai.js'));
  for (const b of graph.ai.boards) for (const i of b.items) assert.match(i.note, /\S/, 'every card says what it does');
});

test('"follow one AI request" walks prompt, safety, cost, call and the provider in that order', () => {
  const refs = graph.ai.flow.steps.map((s) => s.ref);
  const at = (p) => refs.indexOf(p);
  assert.ok(at('f:web/src/prompts.ts') >= 0 && at('f:api/src/safety.js') > at('f:web/src/prompts.ts'));
  assert.ok(at('f:api/src/credit.js') > at('f:api/src/safety.js'));
  assert.ok(at('f:api/src/openai.js') > at('f:api/src/credit.js'));
  assert.equal(refs[refs.length - 1], 'n:openai');
  assert.equal(new Set(refs).size, refs.length, 'no file appears twice');
});

test('the map page includes the AI view and shows nothing for an app without AI', () => {
  const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
  assert.match(html, /ui\/35-ai\.js/);
  const plain = makeProject({
    'web/src/App.tsx': "// safety notes and cost of the order, a price list\nexport default function App() { return 'hello'; }\n",
    'api/src/orders.js': "exports.price = (o) => o.cost; // usage of the safety deposit\n",
  }, { arch: arch(NODES.slice(0, 2)) });
  try {
    scanAndBuild(plain);
    assert.equal(readGraph(plain).ai, undefined);
  } finally { cleanup(plain); }
});

test('an app that calls providers through a configured address (no host in the code) is still found', () => {
  const r = makeProject({
    'api/src/client.php': "<?php\n// sends the chat model prompt to the configured provider\nfunction ask($base, $body) { return post($base . '/chat/completions', $body); }\n",
    'api/src/prompts.php': "<?php\n// chat model system prompt\n$messages = [['role' => 'system', 'content' => 'You are a helpful assistant.']];\n",
  }, { arch: arch([{ id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] }]) });
  try {
    scanAndBuild(r);
    const g = readGraph(r);
    assert.ok(g.ai, 'detected through the request path');
    assert.ok(g.ai.files.find((f) => f.id === 'f:api/src/client.php').roles.includes('call'));
  } finally { cleanup(r); }
});

test('the viewer extension only uses the documented Floorplan API', () => {
  const src = fs.readFileSync(path.join(SKILL, 'assets', 'ui', '35-ai.js'), 'utf8');
  for (const m of src.matchAll(/\bFP\.(\w+)/g)) assert.ok(['graph', 'h', 'showBoard', 'playFlow', 'addHeaderButton', 'addPanelSection'].includes(m[1]), `FP.${m[1]} is part of the extension API`);
});
