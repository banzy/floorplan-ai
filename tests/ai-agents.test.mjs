// Agents lens: finding the AI agents in an app, their tools, handoffs and workflow steps, and the code in charge
// of each. Also what must NOT count: an HTTP agent, an app that calls AI without any agent, and a prompt's text.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SKILL, lib, makeProject, scanAndBuild, readGraph, cleanup } from './helpers.mjs';

const { findAgents } = await lib('agents.mjs');
const code = (p, lang = 'typescript') => ({ path: p, category: 'code', lang });

test('findAgents reads an agent\'s name, model, tools and handoffs from its definition', () => {
  const r = findAgents(`import { Agent } from '@openai/agents';
export const faq = new Agent({ name: 'FAQ helper', handoffDescription: 'Answers product questions', instructions: 'SECRET-PROMPT-TEXT you are a bot', model: 'gpt-4o-mini', tools: [searchDocs, lookup.asTool()] });
export const triage = new Agent({ name: 'Triage', instructions: 'Route it', handoffs: [faq] });`, code('team.ts'));
  assert.equal(r.agents.length, 2);
  const [faq, triage] = r.agents;
  assert.equal(faq.name, 'FAQ helper');
  assert.equal(faq.model, 'gpt-4o-mini');
  assert.equal(faq.goal, 'Answers product questions');
  assert.deepEqual(faq.tools.map((t) => t.name), ['searchDocs', 'lookup']);
  assert.equal(faq.tools[1].agent, true, 'x.asTool() means another agent is used as a tool');
  assert.deepEqual(triage.handoffs, ['faq']);
  assert.equal(faq.instr, true);
  // the instructions are never kept, only that they exist
  assert.ok(!JSON.stringify(r).includes('SECRET-PROMPT-TEXT'));
});

test('findAgents understands Python agents, classes, LangGraph and CrewAI', () => {
  const crew = findAgents(`from crewai import Agent, Crew
researcher = Agent(role="Researcher", goal="Find the facts about a topic", backstory="Curious", llm="gpt-4o")
writer = Agent(role="Writer", goal="Write the final article", backstory="Clear", tools=[publish])
crew = Crew(agents=[researcher, writer])`, code('crew.py', 'python'));
  assert.deepEqual(crew.agents.map((a) => a.name), ['Researcher', 'Writer']);
  assert.deepEqual(crew.crews, [['researcher', 'writer']]);
  const graph = findAgents(`from langgraph.graph import StateGraph, START, END
g = StateGraph(dict)
g.add_node("plan", plan)
g.add_node("write", write)
g.add_edge(START, "plan")
g.add_edge("plan", "write")`, code('flow.py', 'python'));
  assert.deepEqual(graph.graph.nodes.map((n) => n.name), ['plan', 'write']);
  assert.deepEqual(graph.graph.edges, [['START', 'plan'], ['plan', 'write']]);
  const cls = findAgents('class ResearchAgent(Agent):\n    model = "claude-sonnet-4-5"\n    instructions = "Look things up"\n', code('r.py', 'python'));
  assert.equal(cls.agents[0].name, 'Research Agent');
  assert.equal(cls.agents[0].model, 'claude-sonnet-4-5');
});

test('an HTTP agent, a user agent or a plain class named Agent is not an AI agent', () => {
  assert.equal(findAgents("const agent = new https.Agent({ keepAlive: true });\nfetch(url, { agent });", code('net.ts')), null);
  assert.equal(findAgents("import { Agent } from 'undici';\nconst a = new Agent({ connections: 10 });", code('net2.ts')), null);
  assert.equal(findAgents("class Agent { constructor(public name: string) {} }\nconst a = new Agent('x');", code('crm.ts')), null);
  assert.equal(findAgents('# Agent notes\nAn agent is a thing', { path: 'README.md', category: 'docs', lang: 'markdown' }), null);
});

let root, graph;
before(() => {
  root = makeProject({
    'api/agents/team.ts': `import { Agent } from '@openai/agents';
import { searchOrders, refundOrder } from '../tools/orders';
import { searchDocs } from '../tools/knowledge';
import { SUPPORT_RULES } from './prompts';
export const refundAgent = new Agent({ name: 'Refund specialist', handoffDescription: 'Handles refunds', instructions: SUPPORT_RULES, model: 'gpt-4o', tools: [refundOrder, searchOrders] });
export const faqAgent = new Agent({ name: 'FAQ helper', instructions: 'Answer from the docs', model: 'gpt-4o-mini', tools: [searchDocs] });
export const triageAgent = new Agent({ name: 'Support triage', instructions: 'Route the customer', model: 'gpt-4o', handoffs: [refundAgent, faqAgent] });
`,
    'api/agents/prompts.ts': "// system prompt rules for the support chat model\nexport const SUPPORT_RULES = 'You are a support assistant.';\n",
    'api/tools/orders.ts': "import { tool } from '@openai/agents';\nexport const searchOrders = tool({ name: 'search_orders', execute: async () => [] });\nexport const refundOrder = tool({ name: 'refund_order', execute: async () => true });\n",
    'api/tools/knowledge.ts': "// embeddings and vector search for the chat model\nexport const searchDocs = { name: 'search_docs', execute: async (q: string) => q };\n",
    'api/chat.ts': "import { run } from '@openai/agents';\nimport { triageAgent } from './agents/team';\nimport { check } from './safety';\nexport async function chat(req: any, res: any) { check(req.body.q); const r = await run(triageAgent, req.body.q); res.end(r.finalOutput); }\n",
    'api/safety.ts': "// Safety check for the chat model prompt: moderation, a blocklist, and refusing harmful or jailbreak requests.\nexport const check = (q: string) => { if (/jailbreak/.test(q)) throw new Error('decline'); };\n",
    'api/research.py': 'from langgraph.graph import StateGraph, START, END\nfrom openai import OpenAI\n\ndef plan(state): return state\ndef write(state): return state\n\ng = StateGraph(dict)\ng.add_node("plan", plan)\ng.add_node("write", write)\ng.add_edge(START, "plan")\ng.add_edge("plan", "write")\n',
    'package.json': JSON.stringify({ name: 'x', dependencies: { '@openai/agents': '^0.1.0' } }),
  }, { arch: { project: { name: 'agents-fixture', summary: 'Test fixture.' }, nodes: [
    { id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] },
    { id: 'openai', label: 'OpenAI', kind: 'external', summary: 'Writes text.', packages: ['@openai/agents'] },
  ] } });
  scanAndBuild(root);
  graph = readGraph(root);
});
after(() => cleanup(root));

const agent = (name) => graph.ai.agents.find((a) => a.name === name);

test('the agents, their models and who leads whom are on the map', () => {
  assert.ok(graph.ai, 'an app with agents has an AI layer even with no provider URL in the code');
  assert.deepEqual(graph.ai.agents.filter((a) => a.kind === 'agent').map((a) => a.name).sort(), ['FAQ helper', 'Refund specialist', 'Support triage']);
  assert.equal(agent('Support triage').role, 'lead');
  assert.equal(agent('Refund specialist').role, 'specialist');
  assert.equal(agent('Refund specialist').model, 'gpt-4o');
  assert.deepEqual(agent('FAQ helper').providers, ['openai']);
  const handoffs = graph.ai.agentLinks.filter((l) => l.kind === 'handoff');
  assert.equal(handoffs.length, 2);
  assert.ok(handoffs.every((l) => l.from === agent('Support triage').id));
});

test('each agent\'s tools are matched to the file and line that hold their code', () => {
  const t = agent('Refund specialist').tools;
  assert.deepEqual(t.map((x) => x.name).sort(), ['refundOrder', 'searchOrders']);
  assert.ok(t.every((x) => x.ref === 'f:api/tools/orders.ts' && x.line > 0));
  assert.equal(agent('FAQ helper').tools[0].ref, 'f:api/tools/knowledge.ts');
});

test('the code in charge is this agent\'s, not every agent\'s that shares its file', () => {
  const ids = (name) => agent(name).code.map((c) => c.id.replace('f:', '')).sort();
  assert.deepEqual(ids('Refund specialist'), ['api/agents/prompts.ts', 'api/agents/team.ts', 'api/chat.ts', 'api/safety.ts', 'api/tools/orders.ts']);
  assert.ok(!ids('FAQ helper').includes('api/tools/orders.ts'), 'the FAQ agent has no business with the order tools');
  assert.ok(!ids('FAQ helper').includes('api/agents/prompts.ts'));
  const roles = (name, file) => agent(name).code.find((c) => c.id === 'f:' + file).roles;
  assert.ok(roles('Refund specialist', 'api/agents/team.ts').includes('defines'));
  assert.ok(roles('Refund specialist', 'api/agents/prompts.ts').includes('prompt'));
  assert.ok(roles('Refund specialist', 'api/chat.ts').includes('entry'), 'the route that runs the agent starts it');
  assert.ok(roles('Support triage', 'api/safety.ts').includes('guard'), 'what the entry point checks protects its agents');
  assert.ok(roles('FAQ helper', 'api/tools/knowledge.ts').includes('tool'));
});

test('a LangGraph workflow becomes connected steps, kept apart from the agent team', () => {
  const steps = graph.ai.agents.filter((a) => a.kind === 'step');
  assert.deepEqual(steps.map((a) => a.name), ['Plan', 'Write']);
  const link = graph.ai.agentLinks.find((l) => l.kind === 'step');
  assert.equal(link.from, steps[0].id);
  assert.equal(link.to, steps[1].id);
  assert.equal(steps[0].role, 'lead');
  assert.deepEqual(steps[0].code.map((c) => c.id), ['f:api/research.py']);
});

test('graph.json holds no prompt text, and the agents board lists the files', () => {
  assert.ok(!JSON.stringify(graph.ai).includes('Route the customer'));
  assert.ok(!JSON.stringify(graph.ai).includes('Answer from the docs'));
  const board = graph.ai.boards.find((b) => b.id === 'ai:agents');
  assert.ok(board && board.items.some((i) => i.id === 'f:api/agents/team.ts'));
});

test('the map ships the agents view, and an AI app with no agents gets none', () => {
  const html = fs.readFileSync(path.join(root, 'floorplan', 'index.html'), 'utf8');
  assert.match(html, /ui\/36-agents\.js/);
  assert.match(html, /id: 'agents-btn'/);
  const plain = makeProject({
    'api/openai.js': "async function complete(q) {\n  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: q }] }) });\n  return r.json();\n}\nmodule.exports = { complete };\n",
    'api/chat.js': "const { complete } = require('./openai');\nmodule.exports = async (req, res) => res.end((await complete(req.body.q)).text);\n",
  }, { arch: { project: { name: 'plain', summary: 'Test fixture.' }, nodes: [{ id: 'api', label: 'Server', kind: 'service', summary: 'The server.', paths: ['api/**'] }, { id: 'openai', label: 'OpenAI', kind: 'external', summary: 'Writes text.', hosts: ['api.openai.com'] }] } });
  try {
    scanAndBuild(plain);
    const g = readGraph(plain);
    assert.ok(g.ai, 'it still has an AI layer');
    assert.equal(g.ai.agents, undefined, 'a single call to an AI service is not an agent');
  } finally { cleanup(plain); }
});

test('SKILL.md tells the agent about the agents view', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(skill, /\*\*Agents\*\*/);
});
