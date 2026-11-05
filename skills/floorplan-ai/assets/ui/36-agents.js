// Agents view: the AI agents of an app drawn as a diagram. A request comes in, passes its safety and cost checks, reaches
// a lead agent, is handed on to other agents or steps, and ends at an AI service. Every agent card shows its tools and
// the code in charge of it; a click opens the details with a way to find each file on the map.
// Data comes from graph.ai.agents and graph.ai.agentLinks (scripts/lib/agents.mjs).
(() => {
  const FP = window.Floorplan;
  const ai = FP?.graph?.ai;
  if (!ai || !Array.isArray(ai.agents) || !ai.agents.length) return;
  const { h } = FP;
  const A = ai.agents, LINKS = ai.agentLinks || [];
  const byId = new Map(A.map((a) => [a.id, a]));
  const provLabel = (id) => ai.providers.find((p) => p.id === id)?.label || id;
  const base = (id) => String(id).replace(/^f:/, '').split('/').pop();
  const fileOf = (id) => String(id).replace(/^f:/, '');

  const CODE_LABEL = { defines: 'Defines the agent', tool: 'A tool it can use', prompt: 'Its instructions and context', guard: 'Safety checks', meter: 'Cost and limits', memory: 'Memory and lookups', stream: 'Streams its replies', call: 'Calls the AI service', entry: 'Starts it', support: 'Helper code it uses' };
  const CODE_SHORT = { defines: 'agent', tool: 'tool', prompt: 'prompt', guard: 'safety', meter: 'cost', memory: 'memory', stream: 'stream', call: 'AI call', entry: 'starts it', support: 'helper' };
  const ROLE_BADGE = { lead: 'Lead agent', specialist: 'Specialist', middle: 'Passes work on', solo: 'Single agent' };
  const KIND_BADGE = { step: 'Workflow step', inferred: 'Found from code' };
  const FW = { 'openai-agents': 'OpenAI Agents SDK', 'claude-agent-sdk': 'Claude Agent SDK', langgraph: 'LangGraph', crewai: 'CrewAI', autogen: 'AutoGen', mastra: 'Mastra', llamaindex: 'LlamaIndex', 'pydantic-ai': 'Pydantic AI', smolagents: 'smolagents', 'google-adk': 'Google ADK', 'vercel-ai': 'Vercel AI SDK', langchain: 'LangChain' };
  const EDGE = {
    handoff: { label: 'hands off to', color: 'var(--k-call)', dash: '', title: 'Hands the conversation to' },
    tool: { label: 'uses as a tool', color: 'var(--n-script)', dash: '6 5', title: 'Uses as a tool' },
    step: { label: 'then', color: 'var(--n-worker)', dash: '', title: 'Then moves on to' },
    start: { label: '', color: 'var(--k-import)', dash: '2 5', title: 'Starts' },
    check: { label: '', color: 'var(--sev-medium)', dash: '5 4', title: 'Checked by' },
    model: { label: '', color: 'var(--k-http)', dash: '', title: 'Asks the AI service' },
  };

  const style = document.createElement('style');
  style.textContent = `
#agents-view { position: fixed; left: 0; right: 0; bottom: 0; top: var(--hh, 64px); z-index: 8; display: none; background: rgba(var(--bg-rgb), .94); backdrop-filter: blur(10px); }
#agents-view.open { display: flex; flex-direction: column; animation: sheetIn .35s var(--ease); }
#agents-view .ag-bar { display: flex; align-items: center; gap: 12px; padding: 12px 20px 10px; flex-wrap: wrap; }
#agents-view .ag-bar h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
#agents-view .ag-sub { color: var(--text-3); font-size: 12.5px; flex: 1 1 260px; min-width: 200px; }
#agents-view .ag-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--text-3); align-items: center; }
#agents-view .ag-legend i { display: inline-block; width: 22px; height: 0; border-top: 2px solid; vertical-align: middle; margin-right: 6px; }
#agents-view .ag-tools { display: flex; gap: 6px; align-items: center; }
#agents-view .ag-main { flex: 1; min-height: 0; display: flex; position: relative; }
#agents-view .ag-scroll { flex: 1; min-width: 0; overflow: auto; cursor: grab; overscroll-behavior: contain; padding: 8px 20px 28px; }
#agents-view .ag-scroll.drag { cursor: grabbing; user-select: none; }
#agents-view .ag-stage { position: relative; transform-origin: 0 0; }
#agents-view svg.ag-edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
#agents-view .ag-edge { fill: none; stroke-width: 1.8; opacity: .75; transition: opacity .2s var(--ease), stroke-width .2s var(--ease); }
#agents-view .ag-edge.flow { animation: agFlow 1.4s linear infinite; }
@keyframes agFlow { to { stroke-dashoffset: -22; } }
@media (prefers-reduced-motion: reduce) { #agents-view .ag-edge.flow { animation: none; } }
#agents-view .ag-elabel { font-size: 10.5px; fill: var(--text-3); paint-order: stroke; stroke: rgba(var(--bg-rgb), .95); stroke-width: 4px; text-anchor: middle; }
#agents-view.focus .ag-edge { opacity: .12; }
#agents-view.focus .ag-edge.on { opacity: 1; stroke-width: 2.6; }
#agents-view.focus .ag-elabel { opacity: 0; }
#agents-view.focus .ag-elabel.on { opacity: 1; }
#agents-view .ag-lane { position: absolute; border-radius: 22px; background: rgba(var(--ink), .035); border: 1px dashed var(--hair-2); pointer-events: none; }
#agents-view .ag-lane span { position: absolute; left: 16px; top: 9px; font-size: 11.5px; font-weight: 600; color: var(--text-3); }
#agents-view .ag-colh { position: absolute; top: 0; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-4); font-weight: 600; white-space: nowrap; }
#agents-view .ag-node { position: absolute; box-sizing: border-box; border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-card); border: 1px solid var(--hair-2); cursor: pointer; transition: opacity .2s var(--ease), box-shadow .2s var(--ease), transform .2s var(--ease), border-color .2s var(--ease); text-align: left; color: var(--text); font: inherit; padding: 0; }
#agents-view .ag-node:hover { transform: translateY(-2px); box-shadow: var(--shadow-lift); }
#agents-view .ag-node:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
#agents-view.focus .ag-node { opacity: .35; }
#agents-view.focus .ag-node.on { opacity: 1; }
#agents-view .ag-node.sel { border-color: var(--ring); box-shadow: 0 0 0 1px var(--ring), var(--shadow-lift); }
#agents-view .ag-agent { width: 272px; overflow: hidden; }
#agents-view .ag-agent .ag-top { height: 4px; background: var(--ac, var(--n-feature)); }
#agents-view .ag-agent .ag-in { padding: 12px 14px 13px; display: flex; flex-direction: column; gap: 8px; }
#agents-view .ag-nm { display: flex; align-items: center; gap: 8px; }
#agents-view .ag-nm b { font-size: 14.5px; font-weight: 600; line-height: 1.25; flex: 1; min-width: 0; overflow-wrap: anywhere; }
#agents-view .ag-badge { font-size: 10.5px; padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, var(--ac, var(--n-feature)) 18%, transparent); color: var(--ac, var(--n-feature)); font-weight: 600; white-space: nowrap; }
#agents-view .ag-meta { font-size: 11.5px; color: var(--text-3); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
#agents-view .ag-meta code { font-family: var(--mono); font-size: 11px; background: rgba(var(--ink), .07); padding: 1px 6px; border-radius: 6px; color: var(--text-2); }
#agents-view .ag-desc { font-size: 12.5px; color: var(--text-2); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
#agents-view .ag-sec { font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-4); font-weight: 600; margin: 2px 0 -3px; }
#agents-view .ag-chips { display: flex; flex-wrap: wrap; gap: 5px; }
#agents-view .ag-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 3px 8px; border-radius: 8px; background: rgba(var(--ink), .06); color: var(--text-2); max-width: 100%; }
#agents-view .ag-chip .d { width: 7px; height: 7px; border-radius: 50%; flex: none; background: var(--cc, var(--text-4)); }
#agents-view .ag-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#agents-view .ag-chip em { font-style: normal; color: var(--text-4); font-size: 10.5px; }
#agents-view .ag-small { width: 188px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
#agents-view .ag-small .k { font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; font-weight: 600; color: var(--kc, var(--text-3)); }
#agents-view .ag-small b { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
#agents-view .ag-small small { color: var(--text-3); font-size: 11px; overflow-wrap: anywhere; }
#agents-view .ag-small.prov { border-radius: 999px; padding: 12px 18px; }
#agents-view .ag-drawer { width: 340px; flex: none; overflow: auto; margin: 4px 16px 16px 0; border-radius: var(--r-panel); padding: 18px 18px 22px; display: none; overscroll-behavior: contain; }
#agents-view .ag-drawer.open { display: block; animation: sheetIn .3s var(--ease); }
#agents-view .ag-drawer h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
#agents-view .ag-drawer .ag-lead { color: var(--text-2); font-size: 13px; line-height: 1.5; margin: 8px 0 12px; }
#agents-view .ag-drawer h4 { margin: 16px 0 6px; font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--text-4); font-weight: 600; }
#agents-view .ag-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 8px 8px; border-radius: 12px; cursor: pointer; font: inherit; }
#agents-view .ag-row:hover, #agents-view .ag-row:focus-visible { background: rgba(var(--ink), .07); outline: none; }
#agents-view .ag-row .d { width: 9px; height: 9px; border-radius: 50%; margin-top: 5px; flex: none; background: var(--cc, var(--text-4)); }
#agents-view .ag-row b { font-weight: 500; font-size: 13px; display: block; overflow-wrap: anywhere; }
#agents-view .ag-row span { display: block; font-size: 11.5px; color: var(--text-3); line-height: 1.35; overflow-wrap: anywhere; }
#agents-view .ag-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
#agents-view .ag-empty { color: var(--text-3); font-size: 12.5px; padding: 6px 8px; }
@media (max-width: 820px) {
  #agents-view .ag-drawer { position: absolute; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 52%; margin: 0; z-index: 2; }
  #agents-view .ag-bar { padding: 10px 12px 6px; }
  #agents-view .ag-legend { display: none; }
  #agents-view .ag-sub { flex-basis: 100%; order: 3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  #agents-view .ag-bar h2 { font-size: 15px; }
  #agents-view .ag-scroll { padding: 6px 12px 24px; }
}
`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'agents-view';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'AI agents');
  const nAgents = A.filter((a) => a.kind !== 'step').length, nSteps = A.length - nAgents;
  const fws = [...new Set(A.map((a) => a.fw).filter(Boolean))].map((f) => FW[f] || f);
  const countText = `${nAgents ? `${nAgents} agent${nAgents === 1 ? '' : 's'}` : ''}${nAgents && nSteps ? ' and ' : ''}${nSteps ? `${nSteps} workflow step${nSteps === 1 ? '' : 's'}` : ''}`;
  root.innerHTML = `
    <div class="ag-bar">
      <h2>AI agents</h2>
      <div class="ag-sub">${h(countText)}${fws.length ? ` built with ${h(fws.join(', '))}` : ''}. Follow a request from left to right. Click anything to see the code in charge of it.</div>
      <div class="ag-legend" id="ag-legend"></div>
      <div class="ag-tools"><button class="btn icon" id="ag-zout" title="Zoom out" aria-label="Zoom out"><svg class="i" viewBox="0 0 24 24"><path d="M5 12h14"/></svg></button><button class="btn" id="ag-fit">Fit</button><button class="btn icon" id="ag-zin" title="Zoom in" aria-label="Zoom in"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button><button class="btn" id="ag-close">Close</button></div>
    </div>
    <div class="ag-main"><div class="ag-scroll" id="ag-scroll"><div class="ag-sizer" id="ag-sizer"><div class="ag-stage" id="ag-stage"></div></div></div><aside class="ag-drawer glass" id="ag-drawer" aria-live="polite"></aside></div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const scroller = $('#ag-scroll'), sizer = $('#ag-sizer'), stage = $('#ag-stage'), drawer = $('#ag-drawer');

  // ---------- what goes in each column ----------
  const incoming = new Map(), outgoing = new Map();
  for (const l of LINKS) { if (!byId.has(l.from) || !byId.has(l.to)) continue; (incoming.get(l.to) || incoming.set(l.to, []).get(l.to)).push(l); (outgoing.get(l.from) || outgoing.set(l.from, []).get(l.from)).push(l); }
  const depth = new Map(A.map((a) => [a.id, 0]));
  for (let pass = 0; pass < A.length; pass++) {
    let moved = false;
    for (const l of LINKS) if (depth.has(l.from) && depth.has(l.to) && depth.get(l.to) < depth.get(l.from) + 1 && depth.get(l.from) < A.length) { depth.set(l.to, depth.get(l.from) + 1); moved = true; }
    if (!moved) break;
  }
  for (const [id, d] of depth) if (d >= A.length) depth.set(id, 0); // a cycle never pushes anything off the board
  // teams: agents that are connected to each other stay together in their own lane
  const comp = new Map();
  const nbrs = new Map(A.map((a) => [a.id, new Set()]));
  for (const l of LINKS) if (nbrs.has(l.from) && nbrs.has(l.to)) { nbrs.get(l.from).add(l.to); nbrs.get(l.to).add(l.from); }
  const teams = [];
  for (const a of A) {
    if (comp.has(a.id)) continue;
    const members = [], todo = [a.id];
    comp.set(a.id, teams.length);
    while (todo.length) { const id = todo.pop(); members.push(id); for (const o of nbrs.get(id)) if (!comp.has(o)) { comp.set(o, teams.length); todo.push(o); } }
    teams.push(members.map((id) => byId.get(id)));
  }
  const layers = [];
  for (const a of A) (layers[depth.get(a.id)] ||= []).push(a);
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];

  const entries = new Map(), checks = new Map();
  for (const a of A) for (const c of a.code || []) {
    if (c.roles.includes('entry')) (entries.get(c.id) || entries.set(c.id, { id: c.id, agents: [] }).get(c.id)).agents.push(a.id);
    const ck = c.roles.filter((r) => r === 'guard' || r === 'meter');
    if (ck.length && c.id !== 'f:' + a.file) { const e = checks.get(c.id) || checks.set(c.id, { id: c.id, roles: new Set(), agents: [] }).get(c.id); ck.forEach((r) => e.roles.add(r)); e.agents.push(a.id); }
  }
  const provs = new Map();
  for (const a of A) for (const p of a.providers || []) (provs.get(p) || provs.set(p, { id: p, agents: [], models: new Set() }).get(p)).agents.push(a.id);
  for (const a of A) if (a.model) for (const p of a.providers || []) provs.get(p)?.models.add(a.model);

  const nodes = []; // { key, type, col, el, ref?, agent? }
  const colTitles = [];
  let col = 0;
  const cols = [];
  const addCol = (title) => { cols.push([]); colTitles.push(title); return cols.length - 1; };
  const colEntry = entries.size ? addCol('A request starts here') : -1;
  const colCheck = checks.size ? addCol('Checked before the agents') : -1;
  const colLayer = layers.map((l, i) => (l.length ? addCol(i === 0 ? (layers.length > 1 ? 'The lead agent' : 'The agent') : i === 1 ? 'Then hands work to' : 'And then') : -1));
  const colProv = provs.size ? addCol('AI services') : -1;

  const roleColor = (a) => a.kind === 'step' ? 'var(--n-worker)' : a.kind === 'inferred' ? 'var(--n-misc)' : a.role === 'lead' ? 'var(--n-feature)' : a.role === 'middle' ? 'var(--k-call)' : a.role === 'solo' ? 'var(--n-feature)' : 'var(--n-service)';
  const CC = { defines: 'var(--n-feature)', tool: 'var(--n-script)', prompt: 'var(--n-symbol)', guard: 'var(--sev-medium)', meter: 'var(--n-data)', memory: 'var(--n-library)', stream: 'var(--k-http)', call: 'var(--k-http)', entry: 'var(--n-ui)', support: 'var(--text-3)' };
  const mkNode = (c, type, key, className, html, extra = {}) => {
    const el = document.createElement('button');
    el.className = `ag-node ${className}`; el.type = 'button'; el.dataset.key = key; el.innerHTML = html;
    stage.appendChild(el);
    const n = { key, type, col: c, el, ...extra };
    const cs = new Set((extra.agentIds || []).map((id) => comp.get(id) ?? 0));
    n.comp = extra.agent ? comp.get(extra.agent.id) : cs.size > 1 ? -1 : [...cs][0] ?? 0;
    nodes.push(n); cols[c].push(n);
    el.addEventListener('click', (ev) => { ev.stopPropagation(); select(n); });
    return n;
  };
  const chip = (c, text, sub, color) => `<span class="ag-chip" style="--cc:${color}"><i class="d"></i><span>${h(text)}</span>${sub ? `<em>${h(sub)}</em>` : ''}</span>`;

  for (const e of entries.values()) mkNode(colEntry, 'file', e.id, 'ag-small', `<span class="k" style="--kc:var(--n-ui)">Starts it</span><b>${h(base(e.id))}</b><small>${h(fileOf(e.id))}</small>`, { ref: e.id, agentIds: e.agents });
  for (const c of checks.values()) {
    const kind = c.roles.has('guard') && c.roles.has('meter') ? 'Safety and cost check' : c.roles.has('guard') ? 'Safety check' : 'Cost and limits';
    mkNode(colCheck, 'file', c.id, 'ag-small', `<span class="k" style="--kc:${c.roles.has('guard') ? 'var(--sev-medium)' : 'var(--n-data)'}">${h(kind)}</span><b>${h(base(c.id))}</b><small>${h(fileOf(c.id))}</small>`, { ref: c.id, agentIds: c.agents, roles: [...c.roles] });
  }
  for (const a of A) {
    const ac = roleColor(a);
    const badge = KIND_BADGE[a.kind] || ROLE_BADGE[a.role] || 'Agent';
    const toolChips = (a.tools || []).slice(0, 6).map((t) => chip(null, t.name, '', 'var(--n-script)')).join('') + ((a.tools || []).length > 6 ? `<span class="ag-chip"><span>+${a.tools.length - 6} more</span></span>` : '');
    const codeChips = (a.code || []).filter((c) => !c.roles.every((r) => r === 'entry')).slice(0, 5).map((c) => chip(null, base(c.id), CODE_SHORT[c.roles.find((r) => r !== 'defines') || c.roles[0]] || '', CC[c.roles.find((r) => r !== 'defines') || c.roles[0]] || 'var(--text-4)')).join('');
    const meta = `${a.model ? `<code>${h(a.model)}</code>` : ''}${(a.providers || []).length ? `<span>${h((a.providers || []).map(provLabel).slice(0, 2).join(', '))}</span>` : ''}${a.fw && !a.model ? `<span>${h(FW[a.fw] || a.fw)}</span>` : ''}`;
    mkNode(colLayer[depth.get(a.id)], 'agent', a.id, 'ag-agent', `<div class="ag-top" style="--ac:${ac}"></div><div class="ag-in" style="--ac:${ac}">
      <div class="ag-nm"><b>${h(a.name)}</b><span class="ag-badge">${h(badge)}</span></div>
      ${meta ? `<div class="ag-meta">${meta}</div>` : ''}
      <div class="ag-desc">${h(a.summary || '')}</div>
      ${toolChips ? `<div class="ag-sec">Tools</div><div class="ag-chips">${toolChips}</div>` : ''}
      ${codeChips ? `<div class="ag-sec">Code in charge</div><div class="ag-chips">${codeChips}</div>` : ''}
    </div>`, { agent: a, ref: 'f:' + a.file });
  }
  for (const p of provs.values()) {
    const models = [...p.models].slice(0, 3).join(', ');
    mkNode(colProv, 'provider', 'p:' + p.id, 'ag-small prov', `<span class="k" style="--kc:var(--k-http)">AI service</span><b>${h(provLabel(p.id))}</b>${models ? `<small>${h(models)}</small>` : ''}`, { provider: p.id, agentIds: p.agents });
  }

  // ---------- edges ----------
  const nodeOfAgent = new Map(nodes.filter((n) => n.agent).map((n) => [n.agent.id, n]));
  const nodeOfFile = (id, type) => nodes.find((n) => n.key === id && n.col === (type === 'entry' ? colEntry : colCheck));
  const edges = [];
  const addEdge = (a, b, kind) => { if (a && b && a !== b && !edges.some((e) => e.a === a && e.b === b && e.kind === kind)) edges.push({ a, b, kind }); };
  for (const l of LINKS) addEdge(nodeOfAgent.get(l.from), nodeOfAgent.get(l.to), l.kind);
  const leads = A.filter((a) => !(incoming.get(a.id) || []).length);
  for (const a of leads) {
    const to = nodeOfAgent.get(a.id);
    const cks = [...checks.values()].filter((c) => c.agents.includes(a.id));
    const ens = [...entries.values()].filter((e) => e.agents.includes(a.id));
    if (cks.length) {
      for (const c of cks) { addEdge(nodeOfFile(c.id, 'check'), to, 'check'); for (const e of ens) addEdge(nodeOfFile(e.id, 'entry'), nodeOfFile(c.id, 'check'), 'start'); }
    } else for (const e of ens) addEdge(nodeOfFile(e.id, 'entry'), to, 'start');
  }
  for (const a of A) for (const p of a.providers || []) addEdge(nodeOfAgent.get(a.id), nodes.find((n) => n.key === 'p:' + p), 'model');
  // a provider only needs one arrow from the agents that lead to it; keep it readable when many agents share one
  const modelEdges = edges.filter((e) => e.kind === 'model');
  if (modelEdges.length > 8) for (const e of modelEdges) if ((incoming.get(e.a.agent?.id) || []).length) edges.splice(edges.indexOf(e), 1);

  // ---------- layout ----------
  const GAPX = 96, GAPY = 26, LANEGAP = 56;
  const TOP = teams.length > 1 ? 74 : 40;
  let scale = 1;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(svgNS, 'svg');
  svgEl.setAttribute('class', 'ag-edges');
  stage.prepend(svgEl);
  const colHeads = colTitles.map((t) => { const d = document.createElement('div'); d.className = 'ag-colh'; d.textContent = t; stage.appendChild(d); return d; });
  let totalW = 0, totalH = 0;
  function layout() {
    let x = 0;
    const colW = [], colX = [];
    cols.forEach((list, ci) => {
      for (const n of list) { n.w = n.el.offsetWidth; n.h = n.el.offsetHeight; n.x = x; }
      colW[ci] = Math.max(...list.map((n) => n.w), 0); colX[ci] = x;
      x += colW[ci] + GAPX;
    });
    const stackH = (st) => (st.length ? st.reduce((t, n) => t + n.h, 0) + GAPY * (st.length - 1) : 0);
    // each team gets its own band; inside it every column is centred, so a lead sits among the agents it hands to
    let y = TOP;
    laneBox.length = 0;
    teams.forEach((_, ti) => {
      const stacks = cols.map((list) => list.filter((n) => n.comp === ti));
      const hs = stacks.map(stackH), laneH = Math.max(...hs, 0);
      stacks.forEach((st, ci) => { let yy = y + (laneH - hs[ci]) / 2; for (const n of st) { n.y = yy; yy += n.h + GAPY; } });
      laneBox[ti] = { y, h: laneH };
      y += laneH + LANEGAP;
    });
    totalH = Math.max(y - LANEGAP, TOP) + 10;
    // a service or a file that several teams share sits in the middle of the whole board
    cols.forEach((list) => {
      const shared = list.filter((n) => n.comp < 0);
      const hh = stackH(shared);
      let yy = Math.max(TOP, (totalH - 10 - hh) / 2 + TOP / 2);
      for (const n of shared) { n.y = yy; yy += n.h + GAPY; }
    });
    totalW = Math.max(0, x - GAPX);
    totalH = Math.max(totalH, ...nodes.map((n) => n.y + n.h + 10));
    for (const n of nodes) { n.el.style.left = n.x + 'px'; n.el.style.top = n.y + 'px'; }
    colHeads.forEach((d, i) => { d.style.left = colX[i] + 'px'; });
    stage.style.width = totalW + 'px'; stage.style.height = totalH + 'px';
    svgEl.setAttribute('width', totalW); svgEl.setAttribute('height', totalH);
    drawLanes();
    drawEdges();
    applyScale();
  }
  const laneBox = [];
  const laneEls = [];
  function drawLanes() {
    laneEls.splice(0).forEach((e) => e.remove());
    if (teams.length < 2) return;
    teams.forEach((members, i) => {
      const ns = members.map((m) => nodeOfAgent.get(m.id)).filter(Boolean);
      if (!ns.length) return;
      const x1 = Math.min(...ns.map((n) => n.x)) - 14, x2 = Math.max(...ns.map((n) => n.x + n.w)) + 14;
      const y1 = laneBox[i].y - 34, y2 = laneBox[i].y + laneBox[i].h + 14;
      const lead = members.find((m) => !(incoming.get(m.id) || []).length) || members[0];
      const el = document.createElement('div');
      el.className = 'ag-lane';
      el.style.cssText = `left:${x1}px;top:${y1}px;width:${x2 - x1}px;height:${y2 - y1}px`;
      el.innerHTML = `<span>${h(members.length > 1 ? `${lead.name} ${lead.kind === 'step' ? 'workflow' : 'team'}` : lead.name)}</span>`;
      stage.prepend(el); laneEls.push(el);
    });
    stage.prepend(svgEl);
  }
  function drawEdges() {
    svgEl.innerHTML = `<defs>${Object.entries(EDGE).map(([k, e]) => `<marker id="agm-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 10 5 0 9z" fill="${e.color}"/></marker>`).join('')}</defs>`;
    for (const e of edges) {
      const a = e.a, b = e.b, st = EDGE[e.kind];
      const forward = b.x > a.x;
      const x1 = forward ? a.x + a.w : a.x, y1 = a.y + a.h / 2, x2 = forward ? b.x : b.x + b.w, y2 = b.y + b.h / 2;
      const dx = Math.max(40, Math.abs(x2 - x1) / 2);
      const sx = forward ? 1 : -1;
      const d = a.col === b.col
        ? `M${a.x + a.w / 2} ${a.y + a.h} C${a.x + a.w / 2} ${a.y + a.h + 24} ${b.x + b.w / 2} ${b.y - 24} ${b.x + b.w / 2} ${b.y}`
        : `M${x1} ${y1} C${x1 + sx * dx} ${y1} ${x2 - sx * dx} ${y2} ${x2} ${y2}`;
      const p = document.createElementNS(svgNS, 'path');
      p.setAttribute('d', d); p.setAttribute('class', 'ag-edge' + (e.kind === 'handoff' || e.kind === 'step' ? ' flow' : ''));
      p.setAttribute('stroke', st.color); if (st.dash) p.setAttribute('stroke-dasharray', st.dash);
      p.setAttribute('marker-end', `url(#agm-${e.kind})`);
      svgEl.appendChild(p); e.el = p;
      if (st.label && a.col !== b.col) {
        const t = document.createElementNS(svgNS, 'text'); t.setAttribute('class', 'ag-elabel'); t.setAttribute('x', (x1 + x2) / 2); t.setAttribute('y', (y1 + y2) / 2 - 6); t.textContent = st.label;
        svgEl.appendChild(t); e.label = t;
      }
    }
  }
  function applyScale() {
    stage.style.transform = `scale(${scale})`;
    sizer.style.width = Math.ceil(totalW * scale) + 'px'; sizer.style.height = Math.ceil(totalH * scale) + 'px';
  }
  function fit() {
    const availW = root.clientWidth - 40 - (innerWidth > 820 ? 356 : 0);
    scale = Math.max(.35, Math.min(1, availW / (totalW || 1)));
    applyScale(); scroller.scrollTo(0, 0);
  }
  const zoomBy = (f) => { scale = Math.max(.35, Math.min(1.6, scale * f)); applyScale(); };
  $('#ag-fit').onclick = fit; $('#ag-zin').onclick = () => zoomBy(1.2); $('#ag-zout').onclick = () => zoomBy(1 / 1.2);

  // drag the board to move around it
  let drag = null;
  scroller.addEventListener('pointerdown', (ev) => { if (ev.button !== 0 || ev.target.closest('.ag-node')) return; drag = { x: ev.clientX, y: ev.clientY, l: scroller.scrollLeft, t: scroller.scrollTop, moved: false }; });
  window.addEventListener('pointermove', (ev) => { if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) < 4) return; drag.moved = true; scroller.classList.add('drag'); scroller.scrollLeft = drag.l - dx; scroller.scrollTop = drag.t - dy; });
  window.addEventListener('pointerup', () => { if (drag?.moved === false) select(null); drag = null; scroller.classList.remove('drag'); });
  scroller.addEventListener('wheel', (ev) => { if (!ev.ctrlKey && !ev.metaKey) return; ev.preventDefault(); zoomBy(ev.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });

  // legend: only the kinds of connection that exist here
  const kinds = [...new Set(edges.map((e) => e.kind))].filter((k) => k !== 'model' || true);
  $('#ag-legend').innerHTML = kinds.map((k) => `<span><i style="border-color:${EDGE[k].color};${EDGE[k].dash ? 'border-top-style:dashed' : ''}"></i>${h({ handoff: 'Hands off to', tool: 'Uses as a tool', step: 'Next step', start: 'Starts', check: 'Checked by', model: 'Asks the AI service' }[k])}</span>`).join('');

  // ---------- selection and the details drawer ----------
  let selected = null;
  function select(n) {
    selected = n;
    for (const x of nodes) x.el.classList.remove('sel', 'on');
    for (const e of edges) { e.el?.classList.remove('on'); e.label?.classList.remove('on'); }
    root.classList.toggle('focus', !!n);
    if (!n) { drawer.classList.remove('open'); return; }
    n.el.classList.add('sel', 'on');
    const touching = edges.filter((e) => e.a === n || e.b === n);
    for (const e of touching) { e.a.el.classList.add('on'); e.b.el.classList.add('on'); e.el?.classList.add('on'); e.label?.classList.add('on'); }
    // a file or an AI service lights up the agents behind it too
    for (const id of n.agentIds || []) nodeOfAgent.get(id)?.el.classList.add('on');
    renderDrawer(n);
  }
  const reveal = (id) => { close(); FP.reveal(id); };
  const codeRow = (c, extra = '') => {
    const role = c.roles.find((r) => r !== 'defines' && r !== 'entry') || c.roles[0];
    return `<button class="ag-row" data-reveal="${h(c.id)}" style="--cc:${CC[role] || 'var(--text-4)'}"><i class="d"></i><span><b>${h(base(c.id))}${c.line ? ` <small style="color:var(--text-4);font-weight:400">line ${c.line}</small>` : ''}</b><span>${h(c.roles.map((r) => CODE_LABEL[r] || r).join(' · '))}</span><span style="font-family:var(--mono);font-size:11px">${h(fileOf(c.id))}</span>${extra}</span></button>`;
  };
  function followAgent(a) {
    close();
    const steps = [];
    const seen = new Set();
    const push = (ref, note) => { if (ref && !seen.has(ref) && FP.exists(ref)) { seen.add(ref); steps.push({ ref, note }); } };
    const code = a.code || [];
    for (const c of code.filter((x) => x.roles.includes('entry')).slice(0, 1)) push(c.id, 'A request arrives here and starts this agent.');
    for (const c of code.filter((x) => x.roles.includes('guard') || x.roles.includes('meter')).slice(0, 2)) push(c.id, c.roles.includes('guard') ? 'The request is checked for safety first.' : 'The cost is counted and limits are enforced.');
    push('f:' + a.file, `${a.name} takes over${a.model ? ` using ${a.model}` : ''}${a.tools?.length ? `, and can use ${a.tools.length} tool${a.tools.length === 1 ? '' : 's'}` : ''}.`);
    for (const c of code.filter((x) => x.roles.includes('prompt') && x.id !== 'f:' + a.file).slice(0, 1)) push(c.id, 'Its instructions and context come from here.');
    for (const t of (a.tools || []).filter((x) => x.ref).slice(0, 3)) push(t.ref, `Tool: ${t.name}.`);
    for (const l of (outgoing.get(a.id) || []).slice(0, 2)) { const to = byId.get(l.to); if (to) push('f:' + to.file, `Can ${l.kind === 'step' ? 'move on to' : 'hand over to'} ${to.name}.`); }
    const pn = (a.providers || []).map((p) => ai.providers.find((x) => x.id === p)?.nodes?.[0]).find(Boolean);
    if (pn) push('n:' + pn, 'The AI service writes the reply.');
    if (steps.length < 2) { toast('Not enough connected code to follow.'); return; }
    FP.playFlow({ title: `Follow ${a.name}`, description: a.summary || '', steps });
  }
  const toast = (m) => FP.toast(m);
  function showOnMap(items, title, question) {
    close();
    FP.showBoard({ kind: 'AI', icon: 'spark', title, question, items });
  }
  function renderDrawer(n) {
    let html = '';
    if (n.agent) {
      const a = n.agent, ac = roleColor(a);
      const outs = (outgoing.get(a.id) || []).map((l) => ({ l, o: byId.get(l.to) })), ins = (incoming.get(a.id) || []).map((l) => ({ l, o: byId.get(l.from) }));
      html = `<h3>${h(a.name)}</h3>
        <div class="ag-meta" style="margin-top:6px"><span class="ag-badge" style="--ac:${ac}">${h(KIND_BADGE[a.kind] || ROLE_BADGE[a.role] || 'Agent')}</span>${a.fw ? `<span>${h(FW[a.fw] || a.fw)}</span>` : ''}${a.model ? `<code>${h(a.model)}</code>` : ''}</div>
        <p class="ag-lead">${h(a.summary || '')}${a.instr ? ' It has its own written instructions.' : ''}</p>
        ${(a.providers || []).length ? `<div class="ag-meta">Asks ${h(a.providers.map(provLabel).join(', '))}</div>` : ''}
        <h4>Tools it can use${a.tools?.length ? ` · ${a.tools.length}` : ''}</h4>
        ${a.tools?.length ? a.tools.map((t) => t.ref ? `<button class="ag-row" data-reveal="${h(t.ref)}" style="--cc:var(--n-script)"><i class="d"></i><span><b>${h(t.name)}</b><span style="font-family:var(--mono);font-size:11px">${h(fileOf(t.ref))}${t.line ? `:${t.line}` : ''}</span></span></button>` : `<div class="ag-row" style="--cc:var(--n-script);cursor:default"><i class="d"></i><span><b>${h(t.name)}</b><span>Defined outside the code the scan could follow</span></span></div>`).join('') : '<div class="ag-empty">It uses no tools. It only writes answers.</div>'}
        ${outs.length || ins.length ? `<h4>Connections</h4>${ins.map(({ l, o }) => `<button class="ag-row" data-agent="${h(o.id)}" style="--cc:${EDGE[l.kind].color}"><i class="d"></i><span><b>${h(o.name)}</b><span>${h(l.kind === 'handoff' ? 'Can hand a conversation to this agent' : l.kind === 'tool' ? 'Uses this agent as a tool' : 'Comes before this step')}</span></span></button>`).join('')}${outs.map(({ l, o }) => `<button class="ag-row" data-agent="${h(o.id)}" style="--cc:${EDGE[l.kind].color}"><i class="d"></i><span><b>${h(o.name)}</b><span>${h({ handoff: 'This agent can hand work to it', tool: 'Uses it as a tool', step: 'The next step after this one' }[l.kind])}</span></span></button>`).join('')}` : ''}
        <h4>Code in charge · ${a.code?.length || 0} file${(a.code?.length || 0) === 1 ? '' : 's'}</h4>
        ${(a.code || []).map((c) => codeRow(c)).join('') || '<div class="ag-empty">No files found.</div>'}
        <div class="ag-actions"><button class="btn primary" data-act="map">Show on the map</button><button class="btn soft" data-act="follow">Follow it</button><button class="btn soft" data-act="open">Open its file</button></div>`;
    } else if (n.provider) {
      html = `<h3>${h(provLabel(n.provider))}</h3><p class="ag-lead">The AI service these agents ask for answers.</p><h4>Agents that use it</h4>${(n.agentIds || []).map((id) => { const o = byId.get(id); return `<button class="ag-row" data-agent="${h(id)}" style="--cc:${roleColor(o)}"><i class="d"></i><span><b>${h(o.name)}</b>${o.model ? `<span>${h(o.model)}</span>` : ''}</span></button>`; }).join('')}`;
    } else {
      const roles = n.roles || ['entry'];
      html = `<h3>${h(base(n.ref))}</h3><p class="ag-lead">${h(roles.includes('guard') ? 'Checks requests for safety before the agents run.' : roles.includes('meter') ? 'Counts what AI use costs and enforces limits.' : 'Where a request starts the agents.')}</p><div style="font-family:var(--mono);font-size:11.5px;color:var(--text-3);overflow-wrap:anywhere">${h(fileOf(n.ref))}</div><h4>Agents it covers</h4>${(n.agentIds || []).map((id) => { const o = byId.get(id); return `<button class="ag-row" data-agent="${h(id)}" style="--cc:${roleColor(o)}"><i class="d"></i><span><b>${h(o.name)}</b></span></button>`; }).join('')}<div class="ag-actions"><button class="btn primary" data-act="open">Show it on the map</button></div>`;
    }
    drawer.innerHTML = html;
    drawer.classList.add('open');
    drawer.scrollTop = 0;
    drawer.querySelectorAll('[data-reveal]').forEach((b) => b.onclick = () => reveal(b.dataset.reveal));
    drawer.querySelectorAll('[data-agent]').forEach((b) => b.onclick = () => { const t = nodeOfAgent.get(b.dataset.agent); if (t) { select(t); t.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); } });
    drawer.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'open') return reveal(n.ref || 'f:' + n.agent?.file);
      if (act === 'follow' && n.agent) return followAgent(n.agent);
      if (act === 'map' && n.agent) showOnMap((n.agent.code || []).map((c) => ({ id: c.id, note: c.roles.map((r) => CODE_LABEL[r] || r).join(' · ') })), n.agent.name, `The code in charge of ${n.agent.name}`);
    });
  }

  // ---------- open / close ----------
  let laidOut = false;
  function open(agentId) {
    FP.closeMenus?.();
    root.classList.add('open');
    btn?.classList.add('active');
    if (!laidOut) { layout(); laidOut = true; fit(); }
    const t = agentId && nodeOfAgent.get(agentId);
    select(t || null);
    if (t) t.el.scrollIntoView({ block: 'center', inline: 'center' });
  }
  function close() { root.classList.remove('open'); btn?.classList.remove('active'); }
  const isOpen = () => root.classList.contains('open');
  $('#ag-close').onclick = close;
  window.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); if (selected) select(null); else close(); }
  }, true);
  window.addEventListener('resize', () => { if (isOpen() && laidOut) fit(); });

  const btn = FP.addHeaderButton({
    id: 'agents-btn', label: 'Agents', title: 'See the AI agents, how they connect and the code in charge of each',
    svg: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M11 7.8 6.6 15.7M13 7.8l4.4 7.9M8 18h8"/>',
    onClick: () => (isOpen() ? close() : open()),
  });

  FP.addPanelSection('overview', () => ({
    html: `<div class="sec"><h3>AI agents <span class="c">${A.length}</span></h3><div class="list"><a class="row" data-agents-open><span class="dot" style="background:var(--k-call)"></span><span class="rt"><div class="rn">See the agents as a diagram</div><div class="rd">${h(A.slice(0, 3).map((a) => a.name).join(', '))}${A.length > 3 ? ` and ${A.length - 3} more` : ''}. How they connect, what tools they have, and the code behind each.</div></span></a></div></div>`,
    bind: (el) => el?.querySelector('[data-agents-open]')?.addEventListener('click', (ev) => { ev.preventDefault(); open(); }),
  }));
  // a file that defines an agent says so in its details, and can jump to it
  const byFile = new Map();
  for (const a of A) (byFile.get('f:' + a.file) || byFile.set('f:' + a.file, []).get('f:' + a.file)).push(a);
  FP.addPanelSection('item', (id) => {
    const list = typeof id === 'string' ? byFile.get(id) : null;
    if (!list) return null;
    return { html: `<div class="sec"><h3>AI agents here <span class="c">${list.length}</span></h3><div class="list">${list.map((a) => `<a class="row" data-agent-open="${h(a.id)}"><span class="dot" style="background:${roleColor(a)}"></span><span class="rt"><div class="rn">${h(a.name)}</div><div class="rd">${h(a.summary || '')}</div></span></a>`).join('')}</div></div>`, bind: (el) => el?.querySelectorAll('[data-agent-open]').forEach((r) => r.addEventListener('click', (ev) => { ev.preventDefault(); open(r.dataset.agentOpen); })) };
  });

  window.FloorplanAgents = { data: A, open, close };
})();
