// Agents lens: finds the AI agents in an app (a named worker that has instructions, a model and tools, and may
// hand work to other agents), what each one can do, how they connect, and the code in charge of each.
//
// findAgents(src, file) — called by scan.mjs for every code file. Returns what the text declares, stored in
//                         scan.json files[].agentDecl:
//                           { frameworks, agents: [{ name, v, line, fw, model?, goal?, tools, handoffs, instr }],
//                             toolDefs: [{ name, line }], graph?: { nodes: [{ name, fn? }], edges: [[from, to]] } }
// buildAgents(ctx)       — called by buildAi with the files already found to be part of the AI layer. Returns
//                         graph.ai.agents: [{ id, name, kind, fw, file, line, model?, goal?, role, providers,
//                           tools: [{ name, ref?, line?, agent? }], code: [{ id, role }], summary }] and the
//                         links between them, graph.ai.agentLinks: [{ from, to, kind, note }].
//
// Instruction text is never stored: only whether an agent has any, so a prompt can't leak into graph.json.

import path from 'node:path';

const AGENT_CLASSES = ['Agent', 'Experimental_Agent', 'ToolLoopAgent', 'AssistantAgent', 'ReActAgent', 'FunctionAgent', 'CodeAgent', 'ToolCallingAgent', 'LlmAgent', 'ChatAgent', 'AgentDefinition', 'Assistant'];
const AGENT_FACTORIES = ['createReactAgent', 'create_react_agent', 'createAgent', 'create_agent', 'initialize_agent'];

const FRAMEWORKS = [
  { id: 'openai-agents', label: 'OpenAI Agents SDK', re: /@openai\/agents|from\s+agents\s+import|import\s+agents\b|openai-agents/ },
  { id: 'claude-agent-sdk', label: 'Claude Agent SDK', re: /claude[-_]agent[-_]sdk|@anthropic-ai\/claude-agent-sdk|claude_code_sdk/ },
  { id: 'langgraph', label: 'LangGraph', re: /langgraph/i },
  { id: 'crewai', label: 'CrewAI', re: /\bcrewai\b/ },
  { id: 'autogen', label: 'AutoGen', re: /\bautogen\b|autogen_agentchat/ },
  { id: 'mastra', label: 'Mastra', re: /@mastra\// },
  { id: 'llamaindex', label: 'LlamaIndex', re: /llama[-_]?index/i },
  { id: 'pydantic-ai', label: 'Pydantic AI', re: /pydantic_ai|pydantic-ai/ },
  { id: 'smolagents', label: 'smolagents', re: /\bsmolagents\b/ },
  { id: 'google-adk', label: 'Google ADK', re: /google\.adk|@google\/adk/ },
  { id: 'vercel-ai', label: 'Vercel AI SDK', re: /from\s+['"](?:ai|@ai-sdk\/[\w-]+)['"]/ },
  { id: 'langchain', label: 'LangChain', re: /langchain/i },
];
export const frameworkLabel = (id) => FRAMEWORKS.find((f) => f.id === id)?.label || id;

// keys that, inside a constructor, mean "this is a worker for an AI model" and not an http.Agent or a user Agent class
const AGENT_KEYS = /\b(instructions|system_?prompt|system_message|backstory|goal|role|model|llm|tools|handoffs|sub_?agents|prompt)\b\s*[:=]/gi;
const MODEL_RE = /\b(?:model|llm|model_name|modelId)\s*[:=]\s*(?:[\w.]+\(\s*)?["'`]([\w./:@-]{3,60})["'`]/;

const humanize = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/** The text between a bracket at `open` and its partner (strings and nesting respected), capped. */
function balanced(src, open, cap = 4000) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let q = '';
  for (let i = open; i < src.length && i < open + cap; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return src.slice(open + 1, i); }
  }
  return src.slice(open + 1, Math.min(src.length, open + cap));
}

/** The items of `key: [a, b(c), d.asTool()]` / `key=[...]` as { name, agent? }. */
function listOf(body, keys) {
  const m = new RegExp(`\\b(?:${keys})\\s*[:=]\\s*\\[`, 'i').exec(body);
  if (!m) return [];
  const inner = balanced(body, m.index + m[0].length - 1);
  const items = [];
  let depth = 0, cur = '';
  for (const c of inner + ',') {
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { if (cur.trim()) items.push(cur.trim()); cur = ''; } else cur += c;
  }
  return items.map((it) => {
    const viaAgent = /^([A-Za-z_$][\w$]*)\.(?:as_tool|asTool)\b/.exec(it);
    if (viaAgent) return { name: viaAgent[1], agent: true };
    const call = /^(?:handoff|Handoff|tool|Tool|FunctionTool|function_tool)\s*\(\s*([A-Za-z_$][\w$]*)/.exec(it);
    if (call) return { name: call[1] };
    const id = /^([A-Za-z_$][\w$.]*)/.exec(it);
    return id ? { name: id[1].split('.').pop() } : null;
  }).filter(Boolean).slice(0, 30);
}

export function findAgents(src, file) {
  if (file.category !== 'code') return null;
  if (!/agent|graph|crew|assistant/i.test(src)) return null;
  const frameworks = FRAMEWORKS.filter((f) => f.re.test(src)).map((f) => f.id);
  const agents = [];

  const seen = new Set();
  const add = (v, cls, bodyStart, matchIdx, openCh) => {
    if (seen.has(bodyStart)) return;
    seen.add(bodyStart);
    const body = balanced(src, bodyStart);
    const keys = new Set([...body.matchAll(AGENT_KEYS)].map((m) => m[1].toLowerCase().replace(/_/g, '')));
    const strong = [...keys].filter((k) => k !== 'role' && k !== 'model' && k !== 'prompt' && k !== 'llm');
    // two telling keys, or one plus a framework we recognise, so `new https.Agent({ keepAlive })` is not an agent
    if (keys.size < 2 && !(keys.size && frameworks.length)) return;
    if (!strong.length && !frameworks.length) return;
    const nameM = /\b(?:name|role)\s*[:=]\s*["'`]([^"'`\n]{1,60})["'`]/.exec(body);
    const goalM = /\b(?:handoff_?description|description|goal|backstory)\s*[:=]\s*["'`]([^"'`\n]{8,220})["'`]/i.exec(body);
    const model = MODEL_RE.exec(body)?.[1];
    const tools = listOf(body, 'tools|allowedTools|allowed_tools');
    const handoffs = listOf(body, 'handoffs|sub_?agents|managed_?agents|agents').map((x) => x.name);
    const instr = /\b(instructions|system_?prompt|system_message|prompt)\s*[:=]/i.test(body);
    // `agents: { name: AgentDefinition(...) }` and `["name"]: { description, prompt }` carry the name as the key
    const name = (nameM?.[1]) || (v && humanize(v)) || humanize(cls);
    // the names the agent's own definition mentions (outside quotes): which code it leans on
    const refs = [...new Set([...body.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ' ').matchAll(/\b[A-Za-z_$][\w$]{3,}\b/g)].map((m) => m[0]))].slice(0, 60);
    agents.push({ name, v: v || null, line: lineOf(src, matchIdx), fw: frameworks[0] || null, ...(model ? { model } : {}), ...(goalM ? { goal: goalM[1].trim() } : {}), tools, handoffs, instr, refs, cls });
  };

  // const triage = new Agent({ ... })  /  triage = Agent(name=..., ...)  /  new Agent({ ... })
  const clsAlt = AGENT_CLASSES.join('|');
  for (const m of src.matchAll(new RegExp(`(?:(?:export\\s+)?(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*|^[ \\t]*([A-Za-z_][\\w]*)\\s*=\\s*)(?:await\\s+)?(?:new\\s+)?(?:[A-Za-z_$][\\w$]*\\.)?(${clsAlt})(?:\\.create)?\\s*(?:<[^>(]*>)?\\(`, 'gm'))) {
    add(m[1] || m[2], m[3], m.index + m[0].length - 1, m.index);
  }
  for (const m of src.matchAll(new RegExp(`(?<![\\w$.])new\\s+(${clsAlt})\\s*\\(`, 'g'))) {
    if (/(?:=\s*)$/.test(src.slice(Math.max(0, m.index - 3), m.index))) continue; // the assignment form above already took it
    add(null, m[1], m.index + m[0].length - 1, m.index);
  }
  for (const m of src.matchAll(new RegExp(`(?:(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*|^[ \\t]*([A-Za-z_]\\w*)\\s*=\\s*)?(?:await\\s+)?(${AGENT_FACTORIES.join('|')})\\s*\\(`, 'gm'))) {
    add(m[1] || m[2], m[3], m.index + m[0].length - 1, m.index);
  }
  // class ResearchAgent(Agent): / class ResearchAgent extends Agent
  for (const m of src.matchAll(/^[ \t]*(?:export\s+)?class\s+([A-Z]\w*Agent)\b[^\n{:]*(?:\(|extends\s+)\w*(?:Agent|Assistant)\b/gm)) {
    if (agents.some((a) => a.v === m[1])) continue;
    const at = src.indexOf('\n', m.index);
    const body = src.slice(at, at + 3000);
    const model = MODEL_RE.exec(body)?.[1];
    agents.push({ name: humanize(m[1]), v: m[1], line: lineOf(src, m.index), fw: frameworks[0] || null, ...(model ? { model } : {}), tools: [], handoffs: [], instr: /\binstructions|system_?prompt/i.test(body), cls: 'class' });
  }
  // Claude Agent SDK: agents: { "reviewer": { description, prompt, tools } } and AgentDefinition entries keyed by name
  for (const m of src.matchAll(/["']?([A-Za-z][\w-]{1,40})["']?\s*:\s*(?:AgentDefinition\s*\(|\{\s*(?=[^}]*\b(?:description|prompt)\s*:))/g)) {
    const open = m.index + m[0].length - 1;
    if (!/^[({]$/.test(src[open])) continue;
    const body = balanced(src, open);
    if (!/\b(prompt|instructions)\b\s*[:=]/.test(body) || !/\bdescription\s*[:=]/.test(body)) continue;
    if (agents.some((a) => a.line === lineOf(src, m.index))) continue;
    const goalM = /\bdescription\s*[:=]\s*["'`]([^"'`\n]{8,220})["'`]/.exec(body);
    agents.push({ name: humanize(m[1]), v: m[1], line: lineOf(src, m.index), fw: 'claude-agent-sdk', tools: listOf(body, 'tools'), handoffs: [], instr: true, ...(goalM ? { goal: goalM[1] } : {}), ...(MODEL_RE.exec(body) ? { model: MODEL_RE.exec(body)[1] } : {}), cls: 'sub' });
  }

  // tool definitions: @tool def f(), tool({ name }), const f = tool(...), function_tool
  const toolDefs = [];
  for (const m of src.matchAll(/^[ \t]*@(?:function_)?tool\b[^\n]*\n(?:[ \t]*@[^\n]*\n)*[ \t]*(?:async\s+)?def\s+(\w+)/gm)) toolDefs.push({ name: m[1], line: lineOf(src, m.index) });
  for (const m of src.matchAll(/(?:const|let|var|export const)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w.]*\.)?(?:tool|createTool|function_tool|DynamicStructuredTool|DynamicTool)\s*\(/g)) toolDefs.push({ name: m[1], line: lineOf(src, m.index) });
  for (const m of src.matchAll(/^[ \t]*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)[^{\n]*\{[^]{0,80}?\/\*\*?\s*(?:tool|@tool)\b/gm)) toolDefs.push({ name: m[1], line: lineOf(src, m.index) });

  // LangGraph: graph.add_node("name", fn) / addNode, add_edge("a", "b") / addEdge, START and END left out
  let graph = null;
  if (/StateGraph|MessageGraph|\.add_node\(|\.addNode\(/.test(src)) {
    const nodes = [...src.matchAll(/\.(?:add_node|addNode)\(\s*["']([^"']+)["'](?:\s*,\s*([A-Za-z_$][\w$.]*))?/g)].map((m) => ({ name: m[1], ...(m[2] ? { fn: m[2].split('.').pop() } : {}), line: lineOf(src, m.index) }));
    const edges = [...src.matchAll(/\.(?:add_edge|addEdge)\(\s*["']?([\w:]+)["']?\s*,\s*["']?([\w:]+)["']?\s*\)/g)].map((m) => [m[1], m[2]]);
    for (const m of src.matchAll(/\.(?:add_conditional_edges|addConditionalEdges)\(\s*["']([^"']+)["']\s*,[^]*?\{([^}]{0,400})\}/g)) {
      for (const t of m[2].matchAll(/:\s*["']([\w:]+)["']/g)) edges.push([m[1], t[1]]);
    }
    if (nodes.length) graph = { nodes: nodes.slice(0, 30), edges: edges.slice(0, 60) };
  }
  // CrewAI: Crew(agents=[a, b]) and Task(agent=a) tie the members together
  const crews = [...src.matchAll(/\bCrew\s*\(/g)].map((m) => listOf(balanced(src, m.index + m[0].length - 1), 'agents').map((x) => x.name));

  if (!agents.length && !graph && !crews.length) return null;
  return { ...(frameworks.length ? { frameworks } : {}), agents: agents.slice(0, 40), ...(toolDefs.length ? { toolDefs: toolDefs.slice(0, 60) } : {}), ...(graph ? { graph } : {}), ...(crews.length ? { crews } : {}) };
}

// ---------------------------------------------------------------------------------------------------------

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ROLE_LABEL = { support: 'Helper code it uses', defines: 'Defines the agent', tool: 'A tool it can use', prompt: 'Its instructions and context', guard: 'Safety checks', meter: 'Cost and limits', memory: 'Memory and lookups', call: 'Calls the AI service', stream: 'Streams its replies', entry: 'Starts it' };
export { ROLE_LABEL as AGENT_CODE_ROLES };

/**
 * ctx: { scan, graph, files (path -> graph file), info (path -> { roles:Set, providers:Set }), importsOf, importedBy,
 *        isTest, kindsOf, providerLabel(id) }
 */
export function buildAgents(ctx) {
  const { scan, graph, files, info, importsOf, importedBy, isTest, kindsOf } = ctx;
  const agents = [];
  const byVar = new Map(); // `${file}#${var}` and `#${var}` -> id
  const usedIds = new Set();
  const mkId = (file, name) => { let id = 'a:' + slug(`${path.posix.basename(file, path.posix.extname(file))}-${name}`) || 'a:agent'; let n = 2; const base = id; while (usedIds.has(id)) id = `${base}-${n++}`; usedIds.add(id); return id; };

  const decl = (scan.files || []).filter((f) => f.agentDecl && files.has(f.path) && !isTest(f.path));
  const toolFiles = new Map(); // tool name -> [{ file, line }]
  const noteTool = (name, file, line) => { if (!toolFiles.has(name)) toolFiles.set(name, []); toolFiles.get(name).push({ file, line }); };
  for (const f of decl) for (const t of f.agentDecl.toolDefs || []) noteTool(t.name, f.path, t.line);
  // a tool can also be any exported function the agent lists by name
  for (const f of scan.files || []) if (files.has(f.path) && !isTest(f.path)) for (const s of f.symbols || []) if (s.kind === 'function' || s.kind === 'const' || s.kind === 'class') noteTool(s.name, f.path, s.line);

  for (const f of decl) {
    const d = f.agentDecl;
    for (const a of d.agents) {
      const id = mkId(f.path, a.name);
      agents.push({ id, name: a.name, kind: 'agent', refs: a.refs || [], fw: a.fw || d.frameworks?.[0] || null, file: f.path, line: a.line, ...(a.model ? { model: a.model } : {}), ...(a.goal ? { goal: a.goal } : {}), instr: !!a.instr, _tools: a.tools, _handoffs: a.handoffs, _v: a.v });
      if (a.v) { byVar.set(`${f.path}#${a.v}`, id); if (!byVar.has(`#${a.v}`)) byVar.set(`#${a.v}`, id); }
    }
    // each LangGraph node is a step that one agent or function carries out
    if (d.graph) {
      const local = new Map();
      for (const n of d.graph.nodes) {
        const id = mkId(f.path, n.name);
        agents.push({ id, name: humanize(n.name), kind: 'step', refs: [], fw: d.frameworks?.[0] || 'langgraph', file: f.path, line: n.line, instr: false, _tools: [], _handoffs: [], _fn: n.fn || null });
        local.set(n.name, id);
      }
      for (const [a, b] of d.graph.edges) if (local.has(a) && local.has(b)) agents.find((x) => x.id === local.get(a))._handoffs.push(`#node:${local.get(b)}`);
    }
    // CrewAI: members of one crew work together, in the order they are listed
    for (const crew of d.crews || []) for (let i = 0; i + 1 < crew.length; i++) {
      const from = agents.find((x) => x._v === crew[i] && x.file === f.path);
      if (from) from._handoffs.push(crew[i + 1]);
    }
  }

  // an AI file that runs tools in a loop but declares no agent is still an agent, found by its code rather than a framework
  const declaredFiles = new Set(agents.map((a) => a.file));
  const loopFiles = [...info].filter(([p, e]) => !declaredFiles.has(p) && e.roles.has('tools') && (e.roles.has('call') || e.roles.has('prompt'))
    && !/(^|\/)(index|main|app|server|router|routes)\.[a-z]+$/.test(p)).slice(0, 6);
  for (const [p] of loopFiles) {
    const stem = path.posix.basename(p).replace(/\.[^.]+$/, '');
    agents.push({ id: mkId(p, stem), name: humanize(stem), kind: 'inferred', refs: [], fw: null, file: p, line: 1, instr: info.get(p).roles.has('prompt'), _tools: [], _handoffs: [], _v: null });
  }
  if (!agents.length) return null;

  const resolveVar = (file, v) => byVar.get(`${file}#${v}`) || byVar.get(`#${v}`) || null;
  const links = [];
  const addLink = (from, to, kind, note) => { if (from === to || links.some((l) => l.from === from && l.to === to && l.kind === kind)) return; links.push({ from, to, kind, note }); };

  for (const a of agents) {
    // tools: names resolved to the file that holds the code, preferring the agent's own file, then files it imports
    const near = new Set([a.file, ...(importsOf.get(a.file) || [])]);
    a.tools = [];
    for (const t of a._tools) {
      if (t.agent) { const to = resolveVar(a.file, t.name); if (to) { addLink(a.id, to, 'tool', 'Uses this agent as a tool'); continue; } }
      const cands = toolFiles.get(t.name) || [];
      const hit = cands.find((c) => c.file === a.file) || cands.find((c) => near.has(c.file)) || (cands.length === 1 ? cands[0] : null);
      a.tools.push({ name: t.name, ...(hit ? { ref: 'f:' + hit.file, line: hit.line } : {}) });
    }
    if (a._fn) { // a LangGraph step runs a function
      const c = (toolFiles.get(a._fn) || []).find((x) => near.has(x.file)) || (toolFiles.get(a._fn) || [])[0];
      if (c) a.stepFile = { id: 'f:' + c.file, line: c.line, name: a._fn };
    }
    for (const h of a._handoffs) {
      const to = h.startsWith('#node:') ? h.slice(6) : resolveVar(a.file, h);
      if (to) addLink(a.id, to, h.startsWith('#node:') ? 'step' : 'handoff', h.startsWith('#node:') ? 'Then moves on to this step' : 'Can hand the conversation to this agent');
    }
  }

  // ---------- code in charge of each agent ----------
  const exportersOf = new Map(); // symbol name -> [paths]
  for (const f of scan.files || []) if (files.has(f.path)) for (const sy of f.symbols || []) { if (!exportersOf.has(sy.name)) exportersOf.set(sy.name, []); exportersOf.get(sy.name).push({ file: f.path, line: sy.line }); }
  const agentsIn = new Map(); // file -> how many agents it defines
  for (const a of agents) agentsIn.set(a.file, (agentsIn.get(a.file) || 0) + 1);
  const JOBS = ['prompt', 'guard', 'meter', 'memory', 'stream'];
  for (const a of agents) {
    const code = new Map(); // path -> { roles, line }
    const put = (p, role, line) => { if (!files.has(p) || isTest(p)) return; if (!code.has(p)) code.set(p, { roles: new Set(), line: null }); const c = code.get(p); c.roles.add(role); if (line && !c.line) c.line = line; };
    put(a.file, 'defines', a.line);
    // a file that holds only this agent also carries its own jobs; one shared by several agents does not
    if (agentsIn.get(a.file) === 1) for (const r of [...JOBS, 'call']) if (info.get(a.file)?.roles.has(r)) put(a.file, r);
    for (const t of a.tools) if (t.ref) { put(t.ref.slice(2), 'tool', t.line); if (info.get(t.ref.slice(2))?.roles.has('memory')) put(t.ref.slice(2), 'memory'); }
    if (a.stepFile) put(a.stepFile.id.slice(2), 'tool', a.stepFile.line);
    // code the agent's definition names: the rules it follows, the helpers it uses
    const reach = new Set([a.file, ...(importsOf.get(a.file) || [])]);
    for (const n of a.refs || []) for (const hit of exportersOf.get(n) || []) {
      if (hit.file === a.file || !reach.has(hit.file) || !info.has(hit.file)) continue;
      const roles = JOBS.filter((r) => info.get(hit.file).roles.has(r));
      for (const r of roles.length ? roles : ['support']) put(hit.file, r, hit.line);
    }
    // whoever runs the agent starts it; what that code checks and counts around the call protects it
    const entries = [...(importedBy.get(a.file) || [])].filter((x) => !isTest(x)).slice(0, 4);
    for (const q of entries) {
      put(q, 'entry');
      for (const g of importsOf.get(q) || []) { const e = info.get(g); if (!e || g === a.file) continue; for (const r of ['guard', 'meter']) if (e.roles.has(r)) put(g, r); }
    }
    a.code = [...code].map(([p, c]) => ({ id: 'f:' + p, roles: [...c.roles], ...(c.line ? { line: c.line } : {}) }))
      .sort((x, y) => (x.id === 'f:' + a.file ? -1 : y.id === 'f:' + a.file ? 1 : 0) || y.roles.length - x.roles.length).slice(0, 14);
    const provs = new Set();
    if (agentsIn.get(a.file) === 1) for (const pr of info.get(a.file)?.providers || []) provs.add(pr);
    for (const c of a.code) if (c.roles.includes('tool') || c.roles.includes('call')) for (const pr of info.get(c.id.slice(2))?.providers || []) provs.add(pr);
    a.providers = [...provs];
    if (a.model) { const mk = ctx.makerOf?.(a.model); if (mk) a.providers = [...new Set([mk, ...a.providers])]; }
    // an agent with no model of its own runs on whatever the app's AI files talk to
    if (!a.providers.length) for (const pr of info.get(a.file)?.providers || []) a.providers.push(pr);
  }

  // ---------- roles in the team ----------
  const incoming = new Map(), outgoing = new Map();
  for (const l of links) { incoming.set(l.to, (incoming.get(l.to) || 0) + 1); outgoing.set(l.from, (outgoing.get(l.from) || 0) + 1); }
  for (const a of agents) {
    const inn = incoming.get(a.id) || 0, out = outgoing.get(a.id) || 0;
    a.role = !out && !inn ? 'solo' : !inn ? 'lead' : out ? 'middle' : 'specialist';
    const bits = [];
    bits.push(a.kind === 'step' ? 'One step of an AI workflow' : a.kind === 'inferred' ? 'Runs AI with tools in a loop (found from the code)' : `An AI agent${a.fw ? ` built with ${frameworkLabel(a.fw)}` : ''}`);
    if (a.tools.length) bits.push(`${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}`);
    if (out) bits.push(`passes work to ${out} other${out === 1 ? '' : 's'}`);
    a.summary = a.goal ? `${a.goal.replace(/[.\s]+$/, '')}.` : `${bits.join(', ')}.`;
    delete a._tools; delete a._handoffs; delete a._v; delete a._fn; delete a.stepFile; delete a.refs;
  }
  return { agents, links };
}
