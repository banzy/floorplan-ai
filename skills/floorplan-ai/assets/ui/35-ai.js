// AI lens: for apps that use AI, show where it happens, what is sent to it, what checks and limits it,
// and who it talks to, then follow one request through them. Data comes from graph.ai (scripts/lib/ai.mjs).
(() => {
  const FP = window.Floorplan;
  if (!FP) return;
  const G = FP.graph;
  const ai = G.ai;
  if (!ai || !Array.isArray(ai.boards) || !ai.boards.length) return;
  const { h } = FP;

  const style = document.createElement('style');
  style.textContent = `
#ai-menu { position: fixed; width: 340px; max-height: min(70vh, 580px); overflow: auto; transform-origin: top right; overscroll-behavior: contain; }
#ai-menu .ai-g { padding: 10px 12px 4px; font-size: 12px; color: var(--text-3); }
#ai-menu .ai-r { display: block; width: 100%; text-align: left; border: 0; background: none; color: var(--text); padding: 9px 12px; border-radius: 12px; cursor: pointer; transition: background .15s var(--ease); }
#ai-menu .ai-r:hover, #ai-menu .ai-r:focus-visible { background: rgba(var(--ink), .07); outline: none; }
#ai-menu .ai-r b { font-weight: 500; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ai-menu .ai-r span { font-size: 12px; color: var(--text-3); display: block; line-height: 1.35; }
`;
  document.head.appendChild(style);

  const boardById = new Map(ai.boards.map((b) => [b.id, b]));
  const general = ai.boards.filter((b) => !b.id.startsWith('ai:provider:') && b.id !== 'ai:agents');
  const byProvider = ai.boards.filter((b) => b.id.startsWith('ai:provider:'));

  function showBoard(b) {
    closeMenu();
    FP.showBoard({ kind: 'AI', icon: b.icon || 'spark', title: b.title, question: b.question, items: b.items });
  }
  function followRequest() {
    closeMenu();
    if (!ai.flow) return;
    FP.playFlow({ title: ai.flow.title, description: ai.flow.description, steps: ai.flow.steps });
  }

  // ---------- header menu ----------
  const menu = document.createElement('div');
  menu.id = 'ai-menu';
  menu.className = 'menu glass';
  document.body.appendChild(menu);
  let btn = null;
  const row = (key, title, sub) => `<button class="ai-r" data-ai="${h(key)}"><b>${h(title)}</b><span>${h(sub)}</span></button>`;
  function renderMenu() {
    let html = '';
    if (window.FloorplanAgents) html += row('agents', 'The AI agents', `${ai.agents.length} ${ai.agents.length === 1 ? 'agent' : 'agents and steps'} as a diagram: how they connect, their tools, and the code in charge of each.`);
    if (window.FloorplanAgentArchitecture) html += row('archflow', ai.agentArchitecture.title, 'How the app maps onto an AI agent: what it perceives, how it decides, what it can do, and what it remembers.');
    if (ai.flow) html += row('flow', ai.flow.title, 'Watch a request go from the app, through instructions, safety and cost checks, to the AI service.');
    html += `<div class="ai-g">Where it happens</div>`;
    for (const b of general) html += row(b.id, b.title, b.question);
    if (byProvider.length) {
      html += `<div class="ai-g">AI services it talks to</div>`;
      for (const b of byProvider) html += row(b.id, b.title, b.question);
    }
    menu.innerHTML = html;
    menu.querySelectorAll('[data-ai]').forEach((el) => el.onclick = (ev) => {
      ev.stopPropagation();
      if (el.dataset.ai === 'archflow') { closeMenu(); window.FloorplanAgentArchitecture.open(); } else if (el.dataset.ai === 'agents') { closeMenu(); window.FloorplanAgents.open(); } else if (el.dataset.ai === 'flow') followRequest(); else showBoard(boardById.get(el.dataset.ai));
    });
  }
  function place() {
    const r = btn.getBoundingClientRect();
    const w = Math.min(340, innerWidth - 16);
    menu.style.top = r.bottom + 8 + 'px';
    menu.style.width = w + 'px';
    menu.style.right = Math.min(Math.max(8, innerWidth - r.right), innerWidth - 8 - w) + 'px';
  }
  function openMenu() {
    document.body.click(); // let the viewer close its own menus
    renderMenu();
    place();
    menu.classList.add('open');
    menu.querySelector('.ai-r')?.focus();
  }
  function closeMenu() { menu.classList.remove('open'); }
  const isOpen = () => menu.classList.contains('open');

  btn = FP.addHeaderButton({ id: 'ai-btn', label: 'AI', icon: 'spark', title: 'See where the app uses AI and what protects it', onClick: () => (isOpen() ? closeMenu() : openMenu()) });
  window.addEventListener('pointerdown', (ev) => { if (isOpen() && !menu.contains(ev.target) && !btn.contains(ev.target)) closeMenu(); }, true);
  window.addEventListener('keydown', (ev) => {
    if (!isOpen()) return;
    if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); closeMenu(); }
    else ev.stopPropagation(); // keep viewer shortcuts out of the open menu
  }, true);
  window.addEventListener('resize', () => { if (isOpen()) place(); });

  // ---------- details panel ----------
  const ROLE_LABEL = { agent: 'Defines an AI agent', call: 'Sends requests to an AI service', prompt: 'Builds the instructions and context for the AI', stream: 'Streams the AI\'s reply', tools: 'Lets the AI use tools', guard: 'Checks for safety', meter: 'Tracks cost and limits', memory: 'Looks things up for the AI' };
  const fileInfo = new Map(ai.files.map((f) => [f.id, f]));
  FP.addPanelSection('item', (id) => {
    const f = typeof id === 'string' ? fileInfo.get(id) : null;
    if (!f) return null;
    const names = (f.providers || []).map((p) => ai.providers.find((x) => x.id === p)?.label).filter(Boolean);
    const rows = f.roles.map((r) => `<a class="row" data-ai-open="ai:overview"><span class="dot" style="background:var(--n-feature)"></span><span class="rt"><div class="rn">${h(ROLE_LABEL[r] || r)}</div></span></a>`).join('');
    const models = f.models?.length ? `<div class="rd" style="padding:6px 12px 0">Models named here: ${h(f.models.join(', '))}</div>` : '';
    const prov = names.length ? `<div class="rd" style="padding:6px 12px 0">Talks to ${h(names.join(', '))}</div>` : '';
    return { html: `<div class="sec"><h3>Part of the AI layer</h3><div class="list">${rows}</div>${prov}${models}</div>`, bind: (el) => el?.querySelectorAll('[data-ai-open]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); showBoard(boardById.get(a.dataset.aiOpen)); })) };
  });
  FP.addPanelSection('overview', () => ({
    html: `<div class="sec"><h3>AI <span class="c">${ai.files.length}</span></h3><div class="list"><a class="row" data-ai-menu><span class="dot" style="background:var(--n-feature)"></span><span class="rt"><div class="rn">How the app uses AI</div><div class="rd">${h(ai.providers.map((p) => p.label).join(', '))}. See where requests are made, what is sent, and what checks and limits them.</div></span></a></div></div>`,
    bind: (el) => el?.querySelector('[data-ai-menu]')?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); openMenu(); }),
  }));

  // other features (the tour) can open these
  window.FloorplanAi = { data: ai, show: (id) => boardById.get(id) && showBoard(boardById.get(id)), follow: followRequest, openMenu };
})();
