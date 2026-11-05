// AI lens: where an app uses AI, what it sends, what keeps it safe and affordable, and who it talks to,
// so the map can answer "how does the AI part work?" the way Screens answers "what is behind this page?".
//
// findAi(src, file)   — called by scan.mjs for every code file with its source. Returns the roles the
//                       file plays in an AI feature, stored in scan.json files[].ai:
//                         { roles: [...], weights: { role: n }, models: [...], providers: [...] }
//                       roles: call | prompt | stream | tools | guard | meter | memory. `call` from the text means
//                       a provider request path (/chat/completions); build.mjs also adds it from the outside
//                       hosts and packages the scan matched.
// buildAi(ctx)        — called by build.mjs with { graph, scan, root } after the graph is built.
//                       Returns graph.ai (or null when the app doesn't use AI):
//                         { providers: [{ id, label, node? }], files: [{ id, roles, providers, models }],
//                           boards: [{ id, title, question, icon, items: [{ id, note, kind }] }],
//                           flow: { title, description, steps: [{ ref, note }] } | null }
//
// A file counts as part of the AI layer when it calls a provider, or builds prompts, or (for the safety and
// spending roles) also talks about models, prompts or completions, so a general "usage" or "safety" word
// doesn't pull in the rest of the app.

import fs from 'node:fs';
import path from 'node:path';
import { buildAgents } from './agents.mjs';

const AI_LANGS = new Set(['typescript', 'javascript', 'python', 'php', 'ruby', 'go', 'java', 'kotlin', 'rust', 'csharp', 'swift', 'dart', 'vue', 'svelte']);

/** Outside hosts and packages that mean "this file talks to an AI provider". */
const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', hosts: [/(^|\.)api\.openai\.com$/], pkgs: [/^npm:openai$/, /^pypi:openai$/, /^npm:@openai\/agents/, /^pypi:openai-agents$/, /^go:github\.com\/sashabaranov\/go-openai/] },
  { id: 'anthropic', label: 'Anthropic', hosts: [/(^|\.)api\.anthropic\.com$/], pkgs: [/^npm:@anthropic-ai\//, /^pypi:anthropic$/, /^pypi:claude-agent-sdk$/, /^pypi:claude-code-sdk$/] },
  { id: 'google', label: 'Google Gemini', hosts: [/generativelanguage\.googleapis\.com$/, /aiplatform\.googleapis\.com$/], pkgs: [/^npm:@google\/(generative-ai|genai)$/, /^pypi:google$/, /^pypi:google-generativeai$/, /^pypi:vertexai$/] },
  { id: 'groq', label: 'Groq', hosts: [/(^|\.)api\.groq\.com$/], pkgs: [/^npm:groq-sdk$/, /^pypi:groq$/] },
  { id: 'mistral', label: 'Mistral', hosts: [/(^|\.)api\.mistral\.ai$/], pkgs: [/^npm:@mistralai\//, /^pypi:mistralai$/] },
  { id: 'cohere', label: 'Cohere', hosts: [/(^|\.)api\.cohere\.(com|ai)$/], pkgs: [/^npm:cohere-ai$/, /^pypi:cohere$/] },
  { id: 'together', label: 'Together AI', hosts: [/(^|\.)api\.together\.(xyz|ai)$/], pkgs: [/^npm:together-ai$/, /^pypi:together$/] },
  { id: 'openrouter', label: 'OpenRouter', hosts: [/(^|\.)openrouter\.ai$/], pkgs: [] },
  { id: 'deepseek', label: 'DeepSeek', hosts: [/(^|\.)api\.deepseek\.com$/], pkgs: [] },
  { id: 'xai', label: 'xAI', hosts: [/(^|\.)api\.x\.ai$/], pkgs: [] },
  { id: 'perplexity', label: 'Perplexity', hosts: [/(^|\.)api\.perplexity\.ai$/], pkgs: [] },
  { id: 'elevenlabs', label: 'ElevenLabs (voice)', hosts: [/(^|\.)api\.elevenlabs\.io$/], pkgs: [/^npm:elevenlabs$/, /^npm:@elevenlabs\//, /^pypi:elevenlabs$/] },
  { id: 'typesafe', label: 'TypeSafe', hosts: [/(^|\.)api\.typesafe\.ai$/], pkgs: [/^npm:@typesafe\//] },
  { id: 'replicate', label: 'Replicate', hosts: [/(^|\.)api\.replicate\.com$/], pkgs: [/^npm:replicate$/, /^pypi:replicate$/] },
  { id: 'huggingface', label: 'Hugging Face', hosts: [/(^|\.)(api-inference\.)?huggingface\.co$/], pkgs: [/^npm:@huggingface\//, /^pypi:huggingface-hub$/] },
  { id: 'ollama', label: 'Ollama (local)', hosts: [], pkgs: [/^npm:ollama$/, /^pypi:ollama$/] },
  // toolkits that talk to several providers; shown as their own name
  { id: 'vercel-ai', label: 'Vercel AI SDK', hosts: [], pkgs: [/^npm:ai$/, /^npm:@ai-sdk\//] },
  { id: 'langchain', label: 'LangChain', hosts: [], pkgs: [/^npm:langchain$/, /^npm:@langchain\//, /^pypi:langchain/] },
  { id: 'crewai', label: 'CrewAI', hosts: [], pkgs: [/^pypi:crewai/] },
  { id: 'autogen', label: 'AutoGen', hosts: [], pkgs: [/^pypi:(py)?autogen/, /^pypi:ag2$/] },
  { id: 'mastra', label: 'Mastra', hosts: [], pkgs: [/^npm:@mastra\//] },
  { id: 'llamaindex', label: 'LlamaIndex', hosts: [], pkgs: [/^pypi:llama-index/, /^npm:llamaindex$/] },
  { id: 'pydantic-ai', label: 'Pydantic AI', hosts: [], pkgs: [/^pypi:pydantic-ai/] },
  { id: 'smolagents', label: 'smolagents', hosts: [], pkgs: [/^pypi:smolagents$/] },
  { id: 'google-adk', label: 'Google ADK', hosts: [], pkgs: [/^pypi:google-adk$/, /^npm:@google\/adk$/] },
  { id: 'litellm', label: 'LiteLLM', hosts: [], pkgs: [/^pypi:litellm$/, /^npm:litellm$/] },
];
const providerById = new Map(PROVIDERS.map((p) => [p.id, p]));
const providerOfHost = (host) => PROVIDERS.find((p) => p.hosts.some((re) => re.test(host.toLowerCase())));
const providerOfPkg = (pkg) => PROVIDERS.find((p) => p.pkgs.some((re) => re.test(pkg)));

/** A model name in a file points at its maker even when the call goes through a proxy or a config value. */
const MODEL_ID = /\b(gpt-[0-9][\w.-]*|o[134]-(?:mini|preview|pro)?[\w.-]*|claude-[a-z0-9][\w.-]*|gemini-[0-9][\w.-]*|mistral-(?:small|medium|large|tiny)[\w.-]*|mixtral-[\w.-]*|llama-?[0-9][\w.-]*|deepseek-(?:chat|reasoner)|command-r[\w+-]*)\b/gi;
const MODEL_MAKER = [[/^(gpt-|o[134]-)/i, 'openai'], [/^claude-/i, 'anthropic'], [/^gemini-/i, 'google'], [/^(mistral-|mixtral-)/i, 'mistral'], [/^deepseek-/i, 'deepseek'], [/^command-r/i, 'cohere']];

// what the text of a file shows about its job in an AI feature
const PROMPT = /["']?role["']?\s*(?:=>|:|=)\s*["']system["']|\bsystem[_ ]?prompt\b|\bSYSTEM_PROMPT\b|\b(?:instructions|developer_message)\s*[:=]|["']system["']\s*=>|\bYou are (?:a|an|the) [a-z]/i;
const STREAM = /text\/event-stream|\bEventSource\b|["']?stream["']?\s*(?:=>|:|=)\s*(?:true|True)|\bgetReader\(\)|\bserver-sent events?\b|\bSSE\b/;
const TOOLS = /\btool_use\b|\btool_calls?\b|\bfunction_call(?:ing)?\b|\btool_choice\b|["']tools["']\s*(?:=>|:)|\bmcp_servers?\b/i;
const MEMORY = /\bembeddings?\b|\bvector[_ ]?(?:store|db|search|index)\b|\bpgvector\b|\bretriev(?:al|er)\b|\bRAG\b/i;
// words that mean the file is about AI; stream, tools and memory need two of them, since SSE or "embedding"
// show up in plenty of non-AI code
const AI_WORDS = [/\b(?:ai|llm)\b/i, /\bmodels?\b/i, /\bprompts?\b/i, /\bcompletions?\b/i, /\b(?:openai|anthropic|gpt|claude|gemini)\b/i, /\bassistant\b/i, /\bchat\b/i];
const GUARD_WORDS = [/\bmoderat/i, /\bguardrails?\b/i, /\bjailbreak/i, /\bprompt[_ -]?injection\b/i, /\bcontent[_ -]?filter/i, /\bsafety\b/i, /\bblocklist\b|\bdenylist\b/i, /\brefus(?:e|al|ed)\b/i, /\bdecline[ds]?\b/i, /\bharm(?:ful)?\b/i];
const METER_WORDS = [/\bcredits?\b/i, /\bbudget\b/i, /\bquota\b/i, /\bwallet\b/i, /\bspend(?:ing)?\b/i, /\bcost\b/i, /\bprice[sd]?\b|\bpricing\b/i, /\busd\b/i, /\brate[_ -]?limit/i, /\btoken[_ ]?(?:count|usage|limit)s?\b|\b(?:input|output|prompt|completion)_tokens\b|\bmax_tokens\b/i];
const AI_CONTEXT = /\b(ai|llm|model|prompt|completion|openai|anthropic|assistant|chat|gpt|claude|gemini|token)s?\b/i;
// the path part of a provider request: a call through a configured base URL has no host in the file, only this
const API_PATH = /["'`]\/(?:v\d\/)?(?:chat\/completions|completions|responses|messages|embeddings|audio\/(?:speech|transcriptions)|images\/generations)["'`]|:(?:generateContent|streamGenerateContent)\b|\/text-to-speech\//;
const GUARD_PATH = /(^|[/_.-])(safety|moderat\w*|guard\w*|jailbreak)([/_.-]|$)/i;
const METER_PATH = /(^|[/_.-])(credit|budget|quota|billing|wallet|spend|cost|pricing|rate[-_]?limit\w*)([/_.-]|$)/i;

// a file named for a provider (ElevenLabsClient, anthropic_format) belongs with it even if its code only
// speaks to a configured address
const PATH_HINT = [[/elevenlabs/i, 'elevenlabs'], [/anthropic|claude/i, 'anthropic'], [/openai|chatgpt/i, 'openai'], [/groq/i, 'groq'], [/gemini/i, 'google'], [/mistral/i, 'mistral'], [/cohere/i, 'cohere'], [/ollama/i, 'ollama'], [/typesafe|\bjev\b|jev[A-Z_.-]|[a-z_.-]jev\b/i, 'typesafe']];
const CONFIG_FILE = /(^|\/)(config|settings|env|constants|defaults)[^/]*\.[a-z]+$/i;
const distinct = (words, src) => words.filter((re) => re.test(src)).length;
const count = (re, src) => (src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length;

export function findAi(src, file) {
  if (file.category !== 'code' || !AI_LANGS.has(file.lang)) return null;
  const p = file.path;
  const roles = [];
  const weights = {}; // how strongly the text shows each role, to pick the main file for a job
  const models = [...new Set([...src.matchAll(MODEL_ID)].map((m) => m[1].toLowerCase()))].slice(0, 6);
  const talksAi = AI_CONTEXT.test(src);
  if (PROMPT.test(src) && (talksAi || models.length)) { roles.push('prompt'); weights.prompt = Math.min(6, count(PROMPT, src)); }
  if (API_PATH.test(src) && talksAi) { roles.push('call'); weights.call = 2; }
  const aboutAi = talksAi && distinct(AI_WORDS, src) >= 2;
  if (STREAM.test(src) && aboutAi) roles.push('stream');
  if (TOOLS.test(src) && aboutAi) roles.push('tools');
  if (MEMORY.test(src) && aboutAi) roles.push('memory');
  const guardW = distinct(GUARD_WORDS, src) + (GUARD_PATH.test(p) ? 5 : 0);
  if (talksAi && guardW >= 3) { roles.push('guard'); weights.guard = guardW; }
  const meterW = distinct(METER_WORDS, src) + (METER_PATH.test(p) ? 5 : 0);
  if (talksAi && /\btokens?\b/i.test(src) && meterW >= 4) { roles.push('meter'); weights.meter = meterW; }
  const stem = p.split('/').pop().replace(/\.[^.]+$/, '');
  const providers = [...new Set([...models.map((m) => MODEL_MAKER.find(([re]) => re.test(m))?.[1]), ...PATH_HINT.filter(([re]) => re.test(stem)).map(([, id]) => id)].filter(Boolean))];
  if (!roles.length && !providers.length) return null;
  return { roles, ...(Object.keys(weights).length ? { weights } : {}), ...(models.length ? { models } : {}), ...(providers.length ? { providers } : {}) };
}

// ---------------------------------------------------------------------------------------------------------

const ROLE_ORDER = ['agent', 'prompt', 'stream', 'guard', 'meter', 'tools', 'memory', 'call'];
const ROLE_NOTE = {
  agent: () => 'Defines an AI agent: its instructions, model and tools',
  call: (prov) => `Sends requests to ${prov || 'an AI service'}`,
  prompt: () => 'Holds the instructions and context sent to the AI',
  stream: () => 'Shows or sends the AI\'s reply piece by piece as it is written',
  tools: () => 'Lets the AI use tools or call functions',
  guard: () => 'Checks requests or replies for safety',
  meter: () => 'Tracks what AI use costs and enforces limits',
  memory: () => 'Looks things up or remembers them for the AI',
};
const STAGE = { prompt: 1, stream: 2, guard: 3, meter: 4, tools: 5, memory: 5, call: 6 };
const FLOW_NOTE = {
  agent: 'An AI agent takes over, with its own instructions and tools.',
  prompt: 'The question and its context are put together with the instructions the AI follows.',
  stream: 'The reply comes back piece by piece instead of all at once.',
  guard: 'The request is checked for safety before or after it reaches the AI.',
  meter: 'The cost is set aside before the call and the real amount is counted afterwards.',
  tools: 'The AI can use tools or call functions.',
  memory: 'Related material is looked up for the AI.',
  call: 'The request is sent to the AI service.',
};
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+$|_test\.[a-z]+$/i;

const join = (xs) => (xs.length <= 1 ? xs[0] || '' : xs.length === 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export function buildAi({ graph, scan, root }) {
  const files = new Map(graph.files.map((f) => [f.p, f]));
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const scanFiles = new Map((scan.files || []).map((f) => [f.path, f]));
  const topOf = (id) => { let n = nodes.get(id), guard = 0; while (n?.parent && guard++ < 50) n = nodes.get(n.parent); return n?.id || id; };
  const kindsOf = (id) => { const ks = new Set(); let n = nodes.get(id), guard = 0; while (n && guard++ < 50) { ks.add(n.kind); n = nodes.get(n.parent); } return ks; };
  const isTest = (p) => TEST_PATH.test(p) || kindsOf(files.get(p)?.n).has('test');

  // ---------- who calls a provider ----------
  const info = new Map(); // path -> { roles:Set, providers:Set, models:Set, w:{role:n} }
  const entry = (p) => { if (!info.has(p)) info.set(p, { roles: new Set(), providers: new Set(), models: new Set(), w: {} }); return info.get(p); };
  for (const sf of scan.files || []) {
    if (!sf.ai || !files.has(sf.path) || isTest(sf.path)) continue;
    const e = entry(sf.path);
    for (const r of sf.ai.roles) e.roles.add(r);
    Object.assign(e.w, sf.ai.weights || {});
    for (const m of sf.ai.models || []) e.models.add(m);
    // a model id names its maker, but only counts as a call when the same file reaches that maker
  }
  for (const sf of scan.files || []) if (sf.agentDecl && files.has(sf.path) && !isTest(sf.path)) entry(sf.path).roles.add('agent');
  const hinted = new Map(); // path -> Set(provider ids from model ids)
  for (const sf of scan.files || []) if (sf.ai?.providers?.length && files.has(sf.path)) hinted.set(sf.path, new Set(sf.ai.providers));
  const callers = new Map(); // provider id -> Set(paths)
  const addCall = (p, prov) => {
    if (!files.has(p) || isTest(p)) return;
    const e = entry(p);
    e.roles.add('call'); e.providers.add(prov.id);
    if (!callers.has(prov.id)) callers.set(prov.id, new Set());
    callers.get(prov.id).add(p);
  };
  for (const h of scan.hosts || []) { const prov = providerOfHost(h.host); if (prov) addCall(h.from, prov); }
  for (const e of scan.extEdges || []) { const prov = providerOfPkg(e.pkg); if (prov) addCall(e.from, prov); }
  // calls through a configured address: a request path, but no host and no provider named in the file
  const gateways = [...info].filter(([p, e]) => e.roles.has('call') && !e.providers.size && !CONFIG_FILE.test(p)).map(([p]) => p);
  if (!callers.size && !gateways.length && ![...info.values()].some((e) => e.roles.has('agent'))) return null; // no sign the app talks to an AI service: nothing to show

  // a file that mentions a model id and sits with the callers (same part of the app) is named for that maker
  for (const [p, set] of hinted) if (info.has(p)) for (const id of set) if (providerById.has(id)) info.get(p).providers.add(id);

  // keep only the files that really belong to the AI layer
  for (const [p, e] of [...info]) {
    const own = e.roles.size && (e.roles.has('agent') || e.roles.has('call') || e.roles.has('prompt') || e.roles.has('guard') || e.roles.has('meter') || e.roles.has('stream') || e.roles.has('tools') || e.roles.has('memory'));
    if (!own) info.delete(p);
  }
  if (!info.size) return null;

  // ---------- how AI files relate: imports, and one file naming another's code ----------
  const importsOf = new Map();
  for (const l of graph.links || []) if (l.k === 'import' && l.a.startsWith('f:') && l.b.startsWith('f:')) {
    const a = l.a.slice(2), b = l.b.slice(2);
    if (!importsOf.has(a)) importsOf.set(a, new Set());
    importsOf.get(a).add(b);
  }
  const names = new Map(); // path -> words other files use to name it
  for (const p of info.keys()) {
    const f = files.get(p);
    const set = new Set((f.s || []).map((x) => x[0]).filter((n) => n.length >= 6 && /^[A-Z]/.test(n)));
    const stem = path.posix.basename(p).replace(/\.[^.]+$/, '');
    if (/^[A-Z][A-Za-z0-9]{5,}$/.test(stem)) set.add(stem);
    names.set(p, set);
  }
  const touches = new Map(); // path -> Set(path)
  const touch = (a, b) => { if (a === b) return; for (const [x, y] of [[a, b], [b, a]]) { if (!touches.has(x)) touches.set(x, new Set()); touches.get(x).add(y); } };
  for (const p of info.keys()) {
    for (const to of importsOf.get(p) || []) if (info.has(to)) touch(p, to);
    let text = null;
    try { if (root) text = fs.readFileSync(path.join(root, p), 'utf8'); } catch {}
    if (!text) continue;
    for (const [q, ns] of names) {
      if (q === p) continue;
      for (const n of ns) if (new RegExp(`(^|[^\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`).test(text)) { touch(p, q); break; }
    }
  }

  // ---------- providers and their map nodes ----------
  const providerNodes = new Map(); // provider id -> Set(node ids): outside-service nodes that name its host or package
  for (const n of graph.nodes) {
    if (n.kind !== 'external') continue;
    for (const pr of PROVIDERS) {
      const byHost = (n.hosts || []).some((h) => pr.hosts.some((re) => re.test(h.replace(/^\*\./, 'x.').toLowerCase())));
      const byPkg = (n.packages || []).some((k) => pr.pkgs.some((re) => re.test(k.includes(':') ? k : `npm:${k}`)));
      if (!byHost && !byPkg) continue;
      if (!providerNodes.has(pr.id)) providerNodes.set(pr.id, new Set());
      providerNodes.get(pr.id).add(n.id);
    }
  }
  const known = new Set([...callers.keys()]);
  const providers = [...known].map((id) => ({ id, label: providerById.get(id).label, files: callers.get(id).size, ...(providerNodes.get(id)?.size ? { nodes: [...providerNodes.get(id)] } : {}) }))
    .sort((a, b) => b.files - a.files);
  const provLabel = (ids) => join([...ids].map((id) => providerById.get(id)?.label).filter(Boolean).slice(0, 3));

  // ---------- rank files ----------
  const rolesOf = (p) => ROLE_ORDER.filter((r) => info.get(p).roles.has(r));
  const score = (p) => rolesOf(p).length * 3 + (touches.get(p)?.size || 0) + Math.min(3, Math.log10((files.get(p)?.loc || 1) + 1)) + (info.get(p).roles.has('call') ? 2 : 0);
  // the file that is most about one job (not just mentions it): fewer other roles, stronger signal
  const focus = (p, role) => (info.get(p).w[role] || 1) * 2 - rolesOf(p).length + (touches.get(p)?.size || 0) * 0.1;
  const ranked = [...info.keys()].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  const noteOf = (p, only) => {
    const roles = only ? rolesOf(p).filter((r) => only.includes(r)) : rolesOf(p);
    const rs = roles.length ? roles : rolesOf(p);
    const first = ROLE_NOTE[rs[0]](provLabel(info.get(p).providers));
    return rs.length > 1 ? `${first}, and also ${join(rs.slice(1).map((r) => ROLE_NOTE[r]('').replace(/^[A-Z]/, (c) => c.toLowerCase())).slice(0, 2))}` : first;
  };
  const kindOf = (p) => (info.get(p).roles.has('agent') ? 'agent' : info.get(p).roles.has('call') ? 'call' : info.get(p).roles.has('prompt') ? 'prompt' : info.get(p).roles.has('guard') ? 'guard' : info.get(p).roles.has('meter') ? 'meter' : 'part');
  const item = (p, only) => ({ id: 'f:' + p, note: noteOf(p, only), kind: kindOf(p) });
  const ext = (id) => ({ id: 'n:' + id, note: nodes.get(id)?.summary || 'An outside AI service', kind: 'outside' });

  // ---------- boards ----------
  const withRole = (r) => ranked.filter((p) => info.get(p).roles.has(r));
  const boards = [];
  const extNodes = [...new Set([...providerNodes.values()].flatMap((s) => [...s]))];
  boards.push({
    id: 'ai:overview', title: 'Where AI is used', icon: 'spark',
    question: 'Everything in the app that sends, shapes, checks or pays for AI',
    items: [...ranked.slice(0, 18).map((p) => item(p)), ...extNodes.slice(0, 5).map(ext)],
  });
  const prompts = withRole('prompt');
  if (prompts.length) boards.push({ id: 'ai:prompts', title: 'What gets sent to the AI', icon: 'spark', question: 'Where the instructions and context for the AI are put together', items: prompts.slice(0, 20).map((p) => item(p, ['prompt'])) });
  const guards = withRole('guard'), meters = withRole('meter');
  if (guards.length || meters.length) {
    boards.push({
      id: 'ai:limits', title: 'Safety and spending limits', icon: 'spark',
      question: 'What checks AI requests and what keeps the cost under control',
      items: [...guards.slice(0, 8).map((p) => item(p, ['guard'])), ...meters.filter((p) => !guards.includes(p) || meters.length < 8).slice(0, 10).map((p) => item(p, ['meter']))].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i).slice(0, 18),
    });
  }
  for (const pr of providers) {
    const hinted = ranked.filter((p) => info.get(p).providers.has(pr.id));
    const calls = [...new Set([...callers.get(pr.id), ...hinted.filter((p) => info.get(p).roles.has('call'))])].sort((a, b) => score(b) - score(a));
    // the shared gateway (one file that sends every provider's requests) and what is wired to this provider's files
    const via = gateways.filter((p) => !calls.includes(p)).slice(0, 2);
    const near = ranked.filter((p) => !calls.includes(p) && !via.includes(p) && hinted.includes(p)).slice(0, Math.max(0, 12 - calls.length - via.length));
    boards.push({
      id: 'ai:provider:' + pr.id, title: pr.label, icon: 'spark',
      question: `Everything that talks to ${pr.label}, and what sits around it`,
      items: [...calls.slice(0, 10).map((p) => item(p)), ...via.map((p) => ({ ...item(p), note: 'Sends the requests for every AI service, using the address in the settings' })), ...near.map((p) => item(p)), ...(pr.nodes || []).map(ext)],
    });
  }

  // ---------- follow one AI request: the best file for each stage, the app's side first ----------
  const isUi = (p) => kindsOf(files.get(p)?.n).has('ui');
  const seen = new Set();
  const pick = (role, ui) => ranked.filter((p) => !seen.has(p) && info.get(p).roles.has(role) && isUi(p) === ui && !CONFIG_FILE.test(p) && !/(^|\/)(index|main|app|server|router|routes)\.[a-z]+$/.test(p)).sort((a, b) => focus(b, role) - focus(a, role))[0];
  const steps = [];
  const push = (p, role) => { if (p && !seen.has(p)) { seen.add(p); steps.push({ ref: 'f:' + p, note: `${FLOW_NOTE[role]}` , role }); } };
  for (const role of ['prompt', 'stream']) push(pick(role, true), role); // the app's side only builds and shows; the rest happens behind it
  for (const role of ['prompt', 'guard', 'meter', 'call']) push(pick(role, false), role);
  const firstProvider = providers[0];
  if (firstProvider?.nodes?.[0]) steps.push({ ref: 'n:' + firstProvider.nodes[0], note: 'The AI service writes the reply and sends it back.', role: 'provider' });
  const flow = steps.length >= 3 ? { title: 'Follow one AI request', description: 'A request travels from the app through instructions, safety and cost checks to the AI service. Each step is the main file for that job.', steps: steps.slice(0, 8).map(({ ref, note }) => ({ ref, note })) } : null;

  // ---------- agents: who they are, how they connect, and the code in charge of each ----------
  const importedBy = new Map();
  for (const [a, set] of importsOf) for (const b of set) { if (!importedBy.has(b)) importedBy.set(b, new Set()); importedBy.get(b).add(a); }
  let team = null;
  try { team = buildAgents({ scan, graph, files, info, importsOf, importedBy, isTest, kindsOf, makerOf: (m) => MODEL_MAKER.find(([re]) => re.test(m))?.[1] }); } catch { team = null; }
  if (team) {
    boards.splice(1, 0, {
      id: 'ai:agents', title: 'The AI agents', icon: 'spark',
      question: 'Every AI agent and the code in charge of it',
      items: [...new Set(team.agents.flatMap((a) => [a.file, ...a.code.map((c) => c.id.slice(2))]))].slice(0, 22).map((p) => ({ id: 'f:' + p, note: team.agents.filter((a) => a.file === p).map((a) => `Defines ${a.name}`).join('; ') || noteOf(p), kind: team.agents.some((a) => a.file === p) ? 'agent' : kindOf(p) })),
    });
  }

  return {
    ...(team ? { agents: team.agents, agentLinks: team.links } : {}),
    providers,
    files: ranked.map((p) => ({ id: 'f:' + p, roles: rolesOf(p), providers: [...info.get(p).providers], ...(info.get(p).models.size ? { models: [...info.get(p).models].slice(0, 4) } : {}) })),
    boards,
    flow,
  };
}
