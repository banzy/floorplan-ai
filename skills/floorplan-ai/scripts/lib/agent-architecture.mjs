// Agent architecture lens: reads floorplan/agent-architecture.json, which the AI agent writes after reading the
// code, and checks it so the viewer can trust it. It describes how an app maps onto the reference shape of an AI
// agent (perception, reasoning, planning, guardrails, action, iterate, memory, environment, other agents, tools)
// and, where there is one, the pattern for running several agents at once. The scan can't know any of this, so
// it is written by hand; see "Agent architecture" in SKILL.md and references/schema.md.
//
// readAgentArchitecture({ file, resolve, warn }) -> the cleaned object, or null when the file is absent or unusable.
//   resolve(ref) returns a map id ("f:path" or "n:id") for something on the map, or null.
// Refs that aren't on the map are dropped with one warning. Nothing here stores prompt text.

import fs from 'node:fs';

const STATUS = new Set(['present', 'partial', 'absent']);
export const FLOW_STAGES = ['perception', 'reasoning', 'planning', 'guardrails', 'action', 'iterate', 'memory', 'environment', 'agents', 'tools'];
export const CONCURRENT_STAGES = ['initiator', 'readers', 'toolkit', 'results', 'aggregate'];
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function readAgentArchitecture({ file, resolve, warn }) {
  if (!fs.existsSync(file)) return null;
  let d;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { warn(`agent-architecture.json is not valid JSON: ${e.message}`); return null; }
  if (!d || typeof d !== 'object' || Array.isArray(d)) { warn('agent-architecture.json must be an object'); return null; }
  const dropped = [];
  const refs = (list) => (Array.isArray(list) ? list : []).map((r) => { const id = resolve(r); if (!id && typeof r === 'string') dropped.push(r); return id; }).filter(Boolean);
  const ref1 = (r) => { if (r == null) return undefined; const id = resolve(r); if (!id) dropped.push(String(r)); return id || undefined; };

  const stages = (grp, allowed, where) => {
    const out = [], seen = new Set();
    for (const [i, s] of (Array.isArray(grp?.stages) ? grp.stages : []).entries()) {
      if (!allowed.includes(s?.id)) { warn(`agent-architecture.json ${where}.stages[${i}] has an unknown id "${s?.id}" (use ${allowed.join(', ')}); left out`); continue; }
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const summary = str(s.summary, 600);
      if (!summary) { warn(`agent-architecture.json ${where} stage "${s.id}" needs a summary; left out`); continue; }
      let status = s.status;
      if (!STATUS.has(status)) { warn(`agent-architecture.json ${where} stage "${s.id}" status must be present, partial or absent; using partial`); status = 'partial'; }
      out.push({
        id: s.id, label: str(s.label, 60) || s.id, status, summary,
        ...(str(s.sub, 40) ? { sub: str(s.sub, 40) } : {}),
        ...(Array.isArray(s.tags) ? { tags: s.tags.map((t) => str(t, 24)).filter(Boolean).slice(0, 4) } : {}),
        refs: refs(s.refs),
      });
    }
    return out;
  };

  const flowStages = stages(d.flow, FLOW_STAGES, 'flow');
  if (!flowStages.length) { warn('agent-architecture.json needs flow.stages with at least one stage; the agent flow was left out'); return null; }
  const out = {
    title: str(d.title, 80) || 'AI agent architecture',
    verdict: str(d.verdict, 700) || '',
    flow: { ...(str(d.flow?.intro, 400) ? { intro: str(d.flow.intro, 400) } : {}), stages: flowStages },
  };
  if (d.concurrent && typeof d.concurrent === 'object') {
    const cs = stages(d.concurrent, CONCURRENT_STAGES, 'concurrent');
    if (cs.length) {
      out.concurrent = {
        ...(str(d.concurrent.intro, 400) ? { intro: str(d.concurrent.intro, 400) } : {}),
        ...(str(d.concurrent.trigger, 40) ? { trigger: str(d.concurrent.trigger, 40) } : {}),
        stages: cs,
        readers: (Array.isArray(d.concurrent.readers) ? d.concurrent.readers : []).slice(0, 40).map((r) => ({ label: str(r?.label, 70), ...(str(r?.short, 18) ? { short: str(r.short, 18) } : {}), ref: ref1(r?.ref) })).filter((r) => r.label && r.ref),
        ...(Array.isArray(d.concurrent.controls?.items) ? { controls: { title: str(d.concurrent.controls.title, 80) || 'How overlapping work is kept safe', items: d.concurrent.controls.items.map((i) => ({ text: str(i?.text, 400), ref: ref1(i?.ref) })).filter((i) => i.text).slice(0, 8) } } : {}),
      };
    }
  }
  if (Array.isArray(d.gaps?.items)) out.gaps = { title: str(d.gaps.title, 80) || 'Worth knowing', items: d.gaps.items.map((t) => str(t, 500)).filter(Boolean).slice(0, 8) };
  if (dropped.length) warn(`agent-architecture.json: ${dropped.length} ref(s) aren't on the map and were left out (use "f:<file path>" or "n:<node id>"): ${dropped.slice(0, 4).join(', ')}${dropped.length > 4 ? '…' : ''}`);
  return out;
}
