// Unit tests of the feature-proposal core (parseFeatureProposal / applyFeatureProposal) from src/app.js, run with stubs outside the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const src = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'app.js'), 'utf8');
const a = src.indexOf('const PROPOSAL_MAX');
const b = src.indexOf('function proposalHTML(m){');
assert.ok(a > 0 && b > a, 'proposal core not found in src/app.js');
const grab = (name) => { const i = src.indexOf(`function ${name}(`); const j = src.indexOf('\n', i); return src.slice(i, j); };

function setup(project) {
  const calls = { toasts: [], logs: 0, saves: 0 };
  let n = 0;
  const ctx = {
    SCOPES: { setup: 'Setup', fullstack: 'Full-stack', backend: 'Backend', frontend: 'Frontend', architect: 'Arq', po: 'Produto', qa: 'QA' },
    project: () => project, toast: (m) => calls.toasts.push(m), guardMutation: () => true, log: () => { calls.logs++; }, save: () => { calls.saves++; }, render() {}, setSprintOpen() {},
    pad: (x) => String(x).padStart(2, '0'), id: (k) => `${k}-${++n}`,
  };
  vm.createContext(ctx);
  vm.runInContext([
    'function pad(x){return String(x).padStart(2,"0");}',
    grab('createFeature').replace(/id\('feature'\)/, '"feature-"+index'),
    grab('createSprint'), grab('currentSprint'), grab('sprintFeatures'), grab('hasCycle'),
    'function ensureSetup(p){const s=p.features.find(f=>f.setup);for(const f of p.features)if(!f.setup&&s&&!f.dependencies.includes(s.id))f.dependencies.push(s.id);}',
    src.slice(a, b),
  ].join('\n'), ctx);
  return { ctx, calls };
}
const base = () => {
  const s1 = { id: 's1', name: 'Sprint 01', goal: '' };
  return { sprints: [s1], features: [{ id: 'f0', key: 'F00', title: 'Setup do projeto', setup: true, status: 'done', scope: 'setup', sprintId: 's1', dependencies: [], outputs: [] }] };
};

test('parseFeatureProposal normalizes, limits and flags duplicates', () => {
  const { ctx } = setup(base());
  const many = Array.from({ length: 12 }, (_, i) => ({ title: `Feature ${i}`, scope: 'nope', priority: 'p9' }));
  const r = vm.runInContext('parseFeatureProposal', ctx)({ features: [{ title: 'Setup do projeto' }, ...many] });
  assert.equal(r.items.length, 8);
  assert.equal(r.items[0].dup, true);
  assert.equal(r.items[0].on, false);
  assert.equal(r.items[1].scope, 'fullstack');
  assert.equal(r.items[1].priority, 'P1');
  assert.equal(vm.runInContext('parseFeatureProposal', ctx)({ features: [] }), null);
  assert.equal(vm.runInContext('parseFeatureProposal', ctx)({}), null);
});

test('applyFeatureProposal creates backlog features, a new sprint and F00 dependency', () => {
  const p = base();
  const { ctx, calls } = setup(p);
  const proposal = vm.runInContext('parseFeatureProposal', ctx)({
    sprints: [{ name: 'Sprint 02', goal: 'MVP' }],
    features: [
      { title: 'Login', scope: 'backend', sprint: 'Sprint 2', criteria: ['entra com e-mail'], tasks: 'a\nb' },
      { title: 'Tela inicial', scope: 'frontend', sprint: 'Sprint 2', dependencies: ['Login'] },
      { title: 'Relatórios', dependencies: ['F99'] },
    ],
  });
  const m = { proposal };
  const made = vm.runInContext('applyFeatureProposal', ctx)(m);
  assert.equal(JSON.stringify(made.map((f) => f.key)), JSON.stringify(['F01', 'F02', 'F03']));
  assert.equal(p.sprints.length, 2);
  assert.equal(p.sprints[1].goal, 'MVP');
  assert.equal(made[0].sprintId, p.sprints[1].id);
  assert.equal(made[2].sprintId, 's1');
  assert.equal(made[0].status, 'backlog');
  assert.equal(made[0].criteria, '- entra com e-mail');
  assert.equal(made[0].tasks, '- [ ] a\n- [ ] b');
  assert.ok(made[1].dependencies.includes(made[0].id));
  assert.ok(made.every((f) => f.dependencies.includes('f0')));
  assert.equal(proposal.state, 'applied');
  assert.equal(JSON.stringify(proposal.created), JSON.stringify(['F01', 'F02', 'F03']));
  assert.equal(calls.saves, 1);
  assert.equal(vm.runInContext('applyFeatureProposal', ctx)(m), null);
});

test('applyFeatureProposal skips unchecked items and respects the feature limit', () => {
  const p = base();
  const { ctx, calls } = setup(p);
  const proposal = vm.runInContext('parseFeatureProposal', ctx)({ features: [{ title: 'A' }, { title: 'B' }] });
  proposal.items[0].on = false;
  const made = vm.runInContext('applyFeatureProposal', ctx)({ proposal });
  assert.equal(JSON.stringify(made.map((f) => f.title)), JSON.stringify(['B']));
  const full = base();
  for (let i = 0; i < 149; i++) full.features.push({ id: `x${i}`, key: `F${i + 1}`, title: `X${i}`, dependencies: [], outputs: [] });
  const s2 = setup(full);
  const pr = vm.runInContext('parseFeatureProposal', s2.ctx)({ features: [{ title: 'Novo' }, { title: 'Outro' }] });
  assert.equal(vm.runInContext('applyFeatureProposal', s2.ctx)({ proposal: pr }), null);
  assert.match(s2.calls.toasts[0], /Limite/);
  assert.equal(calls.toasts.length, 0);
});
