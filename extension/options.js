import {
  STORAGE_KEY,
  MATCH_TYPES,
  MODES,
  loadState,
  saveState,
  normalizeState,
  newRule,
  newList,
  validateRule,
  findMatch,
  parseBulk,
} from './lib/rules.js';

const $ = (id) => document.getElementById(id);
let state;
let saveTimer;
let lastSavedJson = '';
let backgroundErrors = {};

function fillSelect(sel, options, value) {
  sel.replaceChildren();
  for (const [v, label] of Object.entries(options)) sel.add(new Option(label, v));
  if (value) sel.value = value;
}

function save({ rerender = false, immediate = false } = {}) {
  clearTimeout(saveTimer);
  const doSave = async () => {
    lastSavedJson = JSON.stringify(state);
    await saveState(state);
    $('saved').textContent = 'Salvo ✓';
    $('saved').style.opacity = 1;
    setTimeout(() => ($('saved').style.opacity = 0), 1200);
  };
  if (immediate) doSave();
  else saveTimer = setTimeout(doSave, 350);
  if (rerender) render();
  else refreshDerived();
}

// ---------------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------------

function render() {
  $('globalToggle').checked = state.enabled;
  $('globalLabel').textContent = state.enabled ? 'Ligado' : 'Desligado';

  const box = $('lists');
  box.replaceChildren();
  state.lists.forEach((list, li) => box.append(renderList(list, li)));
  if (!state.lists.length) {
    box.innerHTML = '<div class="card muted">Nenhuma lista. Clique em “+ Nova lista”.</div>';
  }

  const bulkList = $('bulkList');
  const prev = bulkList.value;
  bulkList.replaceChildren();
  for (const l of state.lists) bulkList.add(new Option(l.name, l.id));
  bulkList.add(new Option('+ Nova lista', '__new'));
  if (prev) bulkList.value = prev;
  if (!bulkList.value) bulkList.selectedIndex = 0;

  refreshDerived();
}

function renderList(list, li) {
  const el = $('tplList').content.firstElementChild.cloneNode(true);
  el.dataset.id = list.id;
  const enabled = el.querySelector('.list-enabled');
  enabled.checked = list.enabled;
  enabled.addEventListener('change', () => { list.enabled = enabled.checked; save(); el.style.opacity = list.enabled ? 1 : 0.6; });
  el.style.opacity = list.enabled ? 1 : 0.6;

  const name = el.querySelector('.name');
  name.value = list.name;
  name.addEventListener('input', () => { list.name = name.value; save(); });
  name.addEventListener('change', () => render());

  el.querySelector('.up').disabled = li === 0;
  el.querySelector('.down').disabled = li === state.lists.length - 1;
  el.querySelector('.up').addEventListener('click', () => moveList(li, -1));
  el.querySelector('.down').addEventListener('click', () => moveList(li, 1));
  el.querySelector('.delete-list').addEventListener('click', () => {
    if (list.rules.length && !confirm(`Excluir a lista “${list.name}” e suas ${list.rules.length} regra(s)?`)) return;
    state.lists.splice(li, 1);
    save({ rerender: true, immediate: true });
  });
  el.querySelector('.add-rule').addEventListener('click', () => {
    list.rules.push(newRule());
    save({ rerender: true });
    const inputs = document.querySelectorAll(`[data-id="${list.id}"] .rule .from`);
    inputs[inputs.length - 1]?.focus();
  });

  const rulesBox = el.querySelector('.rules');
  if (list.rules.length) {
    const head = document.createElement('div');
    head.className = 'rule rule-head';
    head.innerHTML = '<span>Ativa</span><span>Tipo</span><span>Origem</span><span></span><span>Destino</span><span></span><span>Modo</span><span></span>';
    rulesBox.append(head);
  }
  list.rules.forEach((rule, ri) => rulesBox.append(renderRule(list, rule, ri)));
  return el;
}

function renderRule(list, rule, ri) {
  const el = $('tplRule').content.firstElementChild.cloneNode(true);
  el.dataset.ruleId = rule.id;

  const enabled = el.querySelector('.enabled');
  enabled.checked = rule.enabled;
  enabled.addEventListener('change', () => { rule.enabled = enabled.checked; el.classList.toggle('off', !rule.enabled); save(); });
  el.classList.toggle('off', !rule.enabled);

  const type = el.querySelector('.type');
  fillSelect(type, MATCH_TYPES, rule.matchType);
  const keep = el.querySelector('.keepPath');
  const keepLabel = keep.closest('label');
  const updateKeep = () => {
    const applicable = rule.matchType === 'domain' || rule.matchType === 'prefix';
    keepLabel.style.visibility = applicable ? 'visible' : 'hidden';
  };
  keep.checked = rule.keepPath;
  keep.addEventListener('change', () => { rule.keepPath = keep.checked; save(); });
  type.addEventListener('change', () => { rule.matchType = type.value; updateKeep(); updatePlaceholders(); save(); });
  updateKeep();

  const from = el.querySelector('.from');
  const to = el.querySelector('.to');
  const updatePlaceholders = () => {
    const ph = {
      domain: ['x.com', 'y.com'],
      prefix: ['https://x.com/news/', 'https://y.com/'],
      exact: ['https://x.com/pagina', 'https://y.com/outra'],
      wildcard: ['*.x.com/*', 'https://y.com/$2'],
      regex: ['^https?://x\\.com/(.*)$', 'https://y.com/$1'],
    }[rule.matchType];
    from.placeholder = ph[0];
    to.placeholder = ph[1];
  };
  updatePlaceholders();
  from.value = rule.from;
  to.value = rule.to;
  from.addEventListener('input', () => { rule.from = from.value; save(); });
  to.addEventListener('input', () => { rule.to = to.value; save(); });

  const mode = el.querySelector('.mode');
  fillSelect(mode, MODES, rule.mode);
  mode.addEventListener('change', () => { rule.mode = mode.value; save(); });

  el.querySelector('.delete').addEventListener('click', () => {
    list.rules.splice(ri, 1);
    save({ rerender: true, immediate: true });
  });

  // Arrastar para reordenar (inclusive entre listas)
  const handle = el.querySelector('.handle');
  handle.addEventListener('mousedown', () => (el.draggable = true));
  el.addEventListener('dragend', () => (el.draggable = false));
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/reder-rule', JSON.stringify({ listId: list.id, ruleId: rule.id }));
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('text/reder-rule')) e.preventDefault();
  });
  el.addEventListener('drop', (e) => {
    const data = e.dataTransfer.getData('text/reder-rule');
    if (!data) return;
    e.preventDefault();
    const { listId, ruleId } = JSON.parse(data);
    const srcList = state.lists.find((l) => l.id === listId);
    const idx = srcList.rules.findIndex((r) => r.id === ruleId);
    const [moved] = srcList.rules.splice(idx, 1);
    const targetIdx = list.rules.findIndex((r) => r.id === rule.id);
    list.rules.splice(targetIdx < 0 ? list.rules.length : targetIdx, 0, moved);
    save({ rerender: true, immediate: true });
  });

  return el;
}

function moveList(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= state.lists.length) return;
  [state.lists[i], state.lists[j]] = [state.lists[j], state.lists[i]];
  save({ rerender: true, immediate: true });
}

/** Atualiza avisos, contadores e teste sem recriar o DOM (mantém o foco). */
function refreshDerived() {
  for (const list of state.lists) {
    const listEl = document.querySelector(`.list[data-id="${list.id}"]`);
    if (!listEl) continue;
    const active = list.rules.filter((r) => r.enabled).length;
    listEl.querySelector('.count').textContent = `${active}/${list.rules.length} ativas`;
    for (const rule of list.rules) {
      const el = listEl.querySelector(`.rule[data-rule-id="${rule.id}"]`);
      if (!el) continue;
      const problems = validateRule(rule);
      if (backgroundErrors[rule.id] && !problems.length) problems.push(backgroundErrors[rule.id]);
      const warn = el.querySelector('.warn');
      warn.hidden = !problems.length;
      warn.textContent = problems.join(' ');
    }
  }
  runTest();
}

function runTest() {
  const raw = $('testUrl').value.trim();
  const out = $('testResult');
  if (!raw) { out.textContent = ''; return; }
  const url = /^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw;
  let normalized;
  try { normalized = new URL(url).href; } catch { out.textContent = 'URL inválida.'; return; }
  const m = findMatch(state, normalized);
  if (!m) {
    out.innerHTML = '<span class="muted">Nenhuma regra ativa corresponde.</span>';
    return;
  }
  out.replaceChildren();
  const a = document.createElement('div');
  a.innerHTML = `<strong style="color:var(--ok)">✓ Corresponde</strong> – lista “<span class="l"></span>”, modo <span class="m"></span>`;
  a.querySelector('.l').textContent = m.list.name;
  a.querySelector('.m').textContent = MODES[m.rule.mode].toLowerCase();
  const b = document.createElement('div');
  b.style.wordBreak = 'break-all';
  b.textContent = '→ ' + m.target;
  out.append(a, b);
}

// ---------------------------------------------------------------------------
// Eventos gerais
// ---------------------------------------------------------------------------

$('globalToggle').addEventListener('change', (e) => {
  state.enabled = e.target.checked;
  $('globalLabel').textContent = state.enabled ? 'Ligado' : 'Desligado';
  save({ immediate: true });
});

$('addList').addEventListener('click', () => {
  state.lists.push(newList({ name: `Lista ${state.lists.length + 1}`, rules: [newRule()] }));
  save({ rerender: true, immediate: true });
  const names = document.querySelectorAll('.list .name');
  names[names.length - 1]?.select();
});

fillSelect($('bulkType'), MATCH_TYPES, 'domain');
fillSelect($('bulkMode'), MODES, 'auto');

$('bulkAdd').addEventListener('click', () => {
  const rules = parseBulk($('bulkText').value, {
    matchType: $('bulkType').value,
    mode: $('bulkMode').value,
    keepPath: $('bulkKeepPath').checked,
  });
  const status = $('bulkStatus');
  if (!rules.length) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Nenhuma linha válida encontrada (use “origem -> destino”).';
    return;
  }
  let listId = $('bulkList').value;
  if (listId === '__new' || !state.lists.length) {
    const l = newList({ name: `Lista ${state.lists.length + 1}` });
    state.lists.push(l);
    listId = l.id;
  }
  state.lists.find((l) => l.id === listId).rules.push(...rules);
  $('bulkText').value = '';
  status.style.color = 'var(--ok)';
  status.textContent = `${rules.length} regra(s) adicionada(s).`;
  save({ rerender: true, immediate: true });
  $('bulkList').value = listId;
});

$('testUrl').addEventListener('input', runTest);

$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'reder', version: 1, ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reder-regras-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const imported = normalizeState(data);
    // Gera novos ids para evitar colisões ao mesclar
    for (const l of imported.lists) {
      l.id = newList().id;
      for (const r of l.rules) r.id = newRule().id;
    }
    if ($('importReplace').checked) state = imported;
    else state.lists.push(...imported.lists);
    save({ rerender: true, immediate: true });
    alert(`Importado: ${imported.lists.length} lista(s).`);
  } catch (err) {
    alert('Arquivo inválido: ' + err.message);
  }
});

// Mudanças feitas em outro lugar (popup, outra aba de opções)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    const incoming = JSON.stringify(normalizeState(changes[STORAGE_KEY].newValue));
    if (incoming !== lastSavedJson && !document.activeElement?.matches('input[type=text], textarea')) {
      state = normalizeState(changes[STORAGE_KEY].newValue);
      lastSavedJson = incoming;
      render();
    }
  }
  if (area === 'session' && changes.reder_errors) {
    backgroundErrors = changes.reder_errors.newValue || {};
    refreshDerived();
  }
});

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

(async () => {
  state = await loadState();
  lastSavedJson = JSON.stringify(state);
  try {
    backgroundErrors = (await chrome.storage.session.get('reder_errors')).reder_errors || {};
  } catch { /* storage.session indisponível para esta página */ }

  // options.html?add=x.com (vindo do menu de contexto)
  const add = new URLSearchParams(location.search).get('add');
  let addedId;
  if (add !== null) {
    if (!state.lists.length) state.lists.push(newList({ name: 'Minha lista' }));
    const r = newRule({ from: add.replace(/^www\./, '') });
    addedId = r.id;
    state.lists[0].rules.push(r);
    history.replaceState(null, '', location.pathname);
    await saveState(state);
    lastSavedJson = JSON.stringify(state);
  }
  render();
  if (addedId) document.querySelector(`.rule[data-rule-id="${addedId}"] .to`)?.focus();
})();
