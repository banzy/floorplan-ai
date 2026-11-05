// Agent architecture lens: how an app maps onto the reference shape of an AI agent (perception, brain, action,
// memory, environment) and, where it has one, the pattern for running several agents at once, each stage pointing at
// the app's real parts. It adds to the viewer and replaces nothing: a section at the top of the right-hand panel, an
// entry in the AI menu, and a "role" note on the cards it points at. The text is written by the AI agent that read the
// code, checked by scripts/lib/agent-architecture.mjs; data: graph.ai.agentArchitecture.
(() => {
  const FP = window.Floorplan;
  const D = FP?.graph?.ai?.agentArchitecture;
  if (!FP || !D || !D.flow) return;
  const { h } = FP;

  const style = document.createElement('style');
  style.textContent = `
    .ag-v { color: var(--text-2); font-size: 13px; line-height: 1.55; margin: 8px 0 0; }
    .ag-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 18px 0 4px; font-size: 13px; font-weight: 600; color: var(--text); }
    .ag-h span { font-weight: 400; font-size: 11.5px; color: var(--text-3); }
    .ag-i { color: var(--text-3); font-size: 12.5px; line-height: 1.5; margin: 0 0 8px; }
    .ag-svg { display: block; width: 100%; height: auto; margin: 6px 0 4px; overflow: visible; }
    .ag-svg text { font-family: inherit; fill: var(--text); }
    .ag-svg .t { font-size: 11px; font-weight: 600; }
    .ag-svg .s { font-size: 8.6px; fill: var(--text-3); }
    .ag-svg .m { font-size: 9px; fill: var(--text-3); }
    .ag-svg .box { fill: color-mix(in srgb, var(--c) 11%, transparent); stroke: var(--c); stroke-width: 1.2; }
    .ag-svg .box.absent { stroke-dasharray: 4 3; fill: transparent; }
    .ag-svg .lane { fill: none; stroke: rgba(var(--ink), .22); stroke-width: 1.1; stroke-dasharray: 5 4; }
    .ag-svg .ln { fill: none; stroke: var(--text-3); stroke-width: 1.2; }
    .ag-svg .arr { fill: var(--text-3); }
    .ag-svg .tool { fill: color-mix(in srgb, var(--sev-medium) 14%, transparent); stroke: var(--sev-medium); stroke-width: 1; }
    .ag-svg .res { fill: rgba(var(--ink), .05); stroke: rgba(var(--ink), .3); stroke-width: 1; }
    .ag-svg [data-go] { cursor: pointer; }
    .ag-svg [data-go]:hover .box { fill: color-mix(in srgb, var(--c) 22%, transparent); }
    .ag-key { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 2px 0 10px; font-size: 11.5px; color: var(--text-3); }
    .ag-key i, .ag-chip i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; background: var(--c); vertical-align: baseline; }
    .ag-key i.absent, .ag-chip i.absent { background: none; border: 1.5px dashed var(--c); width: 6px; height: 6px; }
    .ag-st { --c: var(--ok); } .ag-st.partial { --c: var(--sev-medium); } .ag-st.absent { --c: var(--sev-low); }
    .ag-row { padding: 10px 0; border-top: 1px solid rgba(var(--ink), .08); }
    .ag-row:first-child { border-top: 0; }
    .ag-rt { display: flex; gap: 8px; align-items: center; font-weight: 600; font-size: 13px; }
    .ag-chip { margin-left: auto; font-weight: 400; font-size: 11px; color: var(--c); white-space: nowrap; }
    .ag-rs { color: var(--text-2); font-size: 12.5px; line-height: 1.55; margin-top: 3px; }
    .ag-refs { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 6px; }
    .ag-ref { font-size: 11.5px; color: var(--text-2); background: rgba(var(--ink), .06); border-radius: 999px; padding: 2px 9px; text-decoration: none; cursor: pointer; }
    .ag-ref:hover { background: rgba(var(--ink), .12); }
    .ag-note { padding: 9px 12px; border-radius: 14px; background: rgba(var(--ink), .05); color: var(--text-2); font-size: 12.5px; line-height: 1.55; margin-top: 6px; }
    .ag-list { margin: 0; padding: 0 0 0 18px; color: var(--text-2); font-size: 12.5px; line-height: 1.6; }
    .ag-list li { margin: 4px 0; }
    .ag-role { margin-top: 10px; padding: 10px 12px; border-radius: 14px; background: rgba(var(--ink), .05); font-size: 13px; line-height: 1.55; }
    .ag-role b { display: block; font-size: 11.5px; font-weight: 600; color: var(--text-3); margin-bottom: 3px; }
  `;
  document.head.appendChild(style);

  const STATUS = { present: 'In the app', partial: 'Partly', absent: 'Not in the app' };
  const stagesOf = (grp) => Object.fromEntries((grp.stages || []).map((s) => [s.id, s]));
  const F = stagesOf(D.flow), C = D.concurrent ? stagesOf(D.concurrent) : {};
  const st = (s) => (s && s.status) || 'absent'; // a stage the file leaves out is drawn as not in the app
  const sub = (s, fallback) => (s && s.sub) || fallback;
  // a diagram box links to the first thing on the map that this stage points at
  const go = (s) => { const r = ((s && s.refs) || []).find((x) => FP.exists(x)); return r ? ` data-go="${h(r)}"` : ''; };
  const nameOf = (ref) => { try { return FP.info(ref).name; } catch { return ref; } };

  // ---- diagram 1: perception, brain, action, with memory and environment underneath ----
  function box(s, x, y, w, ht, title, sub) {
    return `<g class="ag-st ${st(s)}"${go(s)}><rect class="box ${st(s)}" x="${x}" y="${y}" width="${w}" height="${ht}" rx="9"/>
      <text class="t" x="${x + w / 2}" y="${y + 15}" text-anchor="middle">${h(title)}</text>
      ${(Array.isArray(sub) ? sub : [sub]).filter(Boolean).map((l, i) => `<text class="s" x="${x + w / 2}" y="${y + 27 + i * 11}" text-anchor="middle">${h(l)}</text>`).join('')}</g>`;
  }
  const arrow = (x1, y1, x2, y2) => {
    const a = Math.atan2(y2 - y1, x2 - x1), hx = x2 - 6 * Math.cos(a), hy = y2 - 6 * Math.sin(a), nx = -Math.sin(a) * 3.2, ny = Math.cos(a) * 3.2;
    return `<line class="ln" x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}"/><path class="arr" d="M${x2} ${y2} L${hx + nx} ${hy + ny} L${hx - nx} ${hy - ny} Z"/>`;
  };
  const both = (x, y1, y2) => arrow(x, y1, x, y2) + arrow(x, y2, x, y1);

  function flowSvg() {
    const tags = (s) => (s && s.tags) || [];
    const lines = (s, x) => tags(s).slice(0, 4).map((t, i) => `<text class="m" x="${x}" y="${88 + i * 13}" text-anchor="middle">${h(t)}</text>`).join('');
    return `<svg class="ag-svg" viewBox="0 0 360 292" role="img" aria-label="Agent flow: perception, then the brain (reasoning and planning), then action, repeating; with memory and the environment underneath">
      <path class="ln" d="M310 38 V20 H54 V36"/><path class="arr" d="M54 40 L50.6 33 L57.4 33 Z"/>
      <text class="m" x="182" y="14" text-anchor="middle">${h(sub(F.iterate, 'Iterate: the next turn'))}</text>
      ${box(F.perception, 6, 42, 90, 108, 'Perception', [sub(F.perception, 'gathers context')])}${lines(F.perception, 51)}
      <rect class="lane" x="116" y="42" width="130" height="108" rx="11"/>
      <text class="t" x="181" y="57" text-anchor="middle">Brain</text>
      ${box(F.reasoning, 124, 64, 114, 38, 'Reasoning', sub(F.reasoning, ''))}
      ${box(F.planning, 124, 108, 114, 36, 'Planning', sub(F.planning, ''))}
      ${box(F.action, 266, 42, 88, 108, 'Action', [sub(F.action, '')])}${lines(F.action, 310)}
      ${arrow(96, 96, 116, 96)}${arrow(246, 96, 266, 96)}
      <g class="ag-st ${st(F.guardrails)}"${go(F.guardrails)}><rect class="box ${st(F.guardrails)}" x="116" y="158" width="238" height="22" rx="8"/><text class="s" x="235" y="172.5" text-anchor="middle" style="fill:var(--text-2)">${h('Guardrails' + (sub(F.guardrails, '') ? ': ' + sub(F.guardrails, '') : ''))}</text></g>
      ${both(51, 154, 206)}${both(181, 184, 206)}${both(310, 154, 206)}
      <rect class="lane" x="6" y="208" width="348" height="76" rx="12"/>
      <text class="m" x="14" y="221">Interaction</text>
      ${box(F.agents, 14, 230, 100, 44, 'Other agents', sub(F.agents, ''))}
      ${box(F.memory, 130, 230, 100, 44, 'Memory', sub(F.memory, ''))}
      ${box(F.environment, 246, 230, 100, 44, 'Environment', sub(F.environment, ''))}
    </svg>`;
  }

  // ---- diagram 2: concurrent execution ----
  function concurrentSvg() {
    const readers = (D.concurrent.readers || []).slice(0, 3).map((r) => r.short || r.label);
    const xs = [10, 130, 250];
    const short = (t) => (t.length > 17 ? t.slice(0, 16) + '…' : t);
    return `<svg class="ag-svg" viewBox="0 0 360 330" role="img" aria-label="Concurrent execution: an initiator sends work to several agents that each have a model, knowledge and tools; a collector combines their results">
      <rect class="res" x="130" y="4" width="100" height="22" rx="11" style="fill:none"/><text class="s" x="180" y="18.5" text-anchor="middle" style="fill:var(--text-2)">${h(D.concurrent.trigger || 'A request')}</text>
      ${arrow(180, 26, 180, 42)}
      ${box(C.initiator, 90, 44, 180, 36, 'Initiator and collector', sub(C.initiator, st(C.initiator) === 'absent' ? 'not in the app' : ''))}
      ${xs.map((x) => `<path class="ln" d="M180 80 V92 H${x + 50} V108"/><path class="arr" d="M${x + 50} 112 L${x + 46.6} 105 L${x + 53.4} 105 Z"/>`).join('')}
      ${xs.map((x, i) => box(C.readers, x, 112, 100, 44, short(readers[i] || 'Agent'), '')).join('')}
      <text class="m" x="180" y="170" text-anchor="middle">${(D.concurrent.readers || []).length ? '… ' + D.concurrent.readers.length + ' in all' : ''}</text>
      <g class="ag-st ${st(C.toolkit)}"${go(C.toolkit)}><rect class="tool" x="10" y="178" width="340" height="38" rx="9"/>
        <text class="t" x="180" y="194" text-anchor="middle">Model, knowledge and tools</text>
        <text class="s" x="180" y="207" text-anchor="middle">${h(sub(C.toolkit, ''))}</text></g>
      ${xs.map((x) => `${arrow(x + 50, 216, x + 50, 232)}<rect class="res" x="${x + 5}" y="234" width="90" height="26" rx="8"/><text class="s" x="${x + 50}" y="250.5" text-anchor="middle" style="fill:var(--text-2)">Intermediate result</text>`).join('')}
      ${xs.map((x) => `<path class="ln" d="M${x + 50} 262 V270 H180 V278"/>`).join('')}
      ${arrow(180, 270, 180, 284)}
      ${box(C.aggregate, 70, 286, 220, 38, 'Aggregated result', sub(C.aggregate, ''))}
    </svg>`;
  }

  const key = `<div class="ag-key"><span class="ag-st"><i></i>${h(STATUS.present)}</span><span class="ag-st partial"><i style="background:var(--c)"></i>${h(STATUS.partial)}</span><span class="ag-st absent"><i class="absent"></i>${h(STATUS.absent)}</span></div>`;
  const refsHtml = (refs) => (refs || []).filter((r) => FP.exists(r)).length
    ? `<div class="ag-refs">${refs.filter((r) => FP.exists(r)).map((r) => `<a class="ag-ref" data-go="${h(r)}">${h(nameOf(r))}</a>`).join('')}</div>` : '';
  const row = (s) => `<div class="ag-row ag-st ${st(s)}"><div class="ag-rt">${h(s.label)}<span class="ag-chip"><i class="${st(s) === 'absent' ? 'absent' : ''}"></i>${h(STATUS[st(s)])}</span></div><div class="ag-rs">${h(s.summary)}</div>${refsHtml(s.refs)}</div>`;

  function body(full) {
    const flow = D.flow, cc = D.concurrent;
    let html = `<p class="ag-v">${h(D.verdict || '')}</p>
      <div class="ag-h">Agent flow<span>perceive · think · act · repeat</span></div>
      ${flow.intro ? `<p class="ag-i">${h(flow.intro)}</p>` : ''}${flowSvg()}${key}
      ${full ? flow.stages.map(row).join('') : ''}`;
    if (cc) {
      html += `<div class="ag-h">Concurrent execution<span>several agents at once</span></div>
        ${cc.intro ? `<p class="ag-i">${h(cc.intro)}</p>` : ''}${concurrentSvg()}${key}`;
      if (full) {
        html += cc.stages.map(row).join('');
        html += `<div class="ag-h">Agents<span>${(cc.readers || []).length} of them</span></div><div class="ag-refs">${(cc.readers || []).filter((r) => FP.exists(r.ref)).map((r) => `<a class="ag-ref" data-go="${h(r.ref)}">${h(r.label)}</a>`).join('')}</div>`;
        if (cc.controls) html += `<div class="ag-h">${h(cc.controls.title)}</div><ul class="ag-list">${cc.controls.items.map((i) => `<li>${h(i.text)}${FP.exists(i.ref) ? ` <a class="ag-ref" data-go="${h(i.ref)}">${h(nameOf(i.ref))}</a>` : ''}</li>`).join('')}</ul>`;
      }
    }
    if (full && D.gaps) html += `<div class="ag-h">${h(D.gaps.title)}</div><ul class="ag-list">${D.gaps.items.map((t) => `<li>${h(t)}</li>`).join('')}</ul>`;
    return html;
  }

  // right-hand panel, codebase view: right after the project header, so it is seen first
  FP.addPanelSection('overview', () => ({
    top: true,
    html: `<div class="sec"><h3>${h(D.title || 'AI agent architecture')}</h3>${body(false)}
      <div class="actions" style="margin-top:12px"><button class="btn soft" data-ag-full>${FP.iconI('spark')}Open the full breakdown</button></div></div>`,
    bind: (el) => el.querySelector('[data-ag-full]')?.addEventListener('click', openFull),
  }));

  // the same, in full, in the panel; its links work as everywhere else
  function openFull() {
    FP.showPanel(`<div class="sec"><div class="ph"><span class="kind">Agent architecture</span></div><h2 class="pt">${h(D.title || 'AI agent architecture')}</h2>${body(true)}
      <div class="actions" style="margin-top:14px"><button class="btn soft" data-ag-back>Back to the codebase</button></div></div>`, (el) => {
      el.querySelector('[data-ag-back]')?.addEventListener('click', () => FP.closePanel());
      el.querySelectorAll('[data-go]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); FP.closePanel(); FP.reveal(a.dataset.go); }));
    });
  }
  // no header button of its own: it opens from the AI menu (35-ai.js) and from the overview panel above

  // a card that is part of the agent flow says so
  const roles = new Map();
  const note = (id, label, s) => { if (!id) return; const k = id.startsWith('m:') ? 'f:' + id.slice(2) : id; (roles.get(k) || roles.set(k, []).get(k)).push({ label, s }); };
  for (const grp of [D.flow, D.concurrent || {}]) for (const s of grp.stages || []) for (const r of s.refs || []) note(r, s.label, s);
  FP.addPanelSection('item', (id) => {
    const mine = roles.get(id.startsWith('m:') ? 'f:' + id.slice(2) : id);
    if (!mine) return '';
    return { top: true, html: `<div class="sec"><div class="ag-role"><b>Role in the agent flow</b>${mine.map((m) => `${h(m.label)}: ${h(m.s.summary)}`).join('<br><br>')}</div></div>` };
  });

  window.FloorplanAgentArchitecture = { open: openFull, data: D };
})();
