import { loadState, saveState, findMatch, newRule, newList, validateRule } from './lib/rules.js';

const $ = (id) => document.getElementById(id);
let state;
let tab;

async function render() {
  state = await loadState();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $('globalToggle').checked = state.enabled;
  $('globalLabel').textContent = state.enabled ? 'Ligado' : 'Desligado';

  // Página atual
  let host = '';
  try {
    const u = new URL(tab?.url || '');
    if (/^https?:$/.test(u.protocol)) host = u.hostname;
  } catch { /* página interna */ }
  $('site').textContent = host || 'Página interna do navegador';
  $('quickAdd').hidden = !host;
  if (host && !$('addFrom').value) $('addFrom').value = host.replace(/^www\./, '');

  const match = host ? findMatch(state, tab.url) : null;
  $('matchInfo').hidden = !match;
  $('redirectNow').hidden = !match;
  if (match) {
    $('matchLabel').textContent =
      `Regra ${match.rule.mode === 'manual' ? 'manual' : 'automática'} da lista “${match.list.name}”:`;
    $('matchTarget').textContent = '→ ' + match.target;
  }

  // Listas
  const sel = $('addList');
  const prev = sel.value;
  sel.replaceChildren();
  for (const l of state.lists) sel.add(new Option(l.name, l.id));
  sel.add(new Option('+ Nova lista', '__new'));
  if (prev) sel.value = prev;
  if (!sel.value) sel.selectedIndex = 0;
  $('newListName').hidden = sel.value !== '__new';

  const box = $('lists');
  box.replaceChildren();
  if (!state.lists.length) {
    box.innerHTML = '<span class="small muted">Nenhuma lista ainda.</span>';
  }
  for (const l of state.lists) {
    const label = document.createElement('label');
    label.innerHTML = '<span class="switch"><input type="checkbox"><span></span></span><span class="name"></span><span class="count small muted"></span>';
    const cb = label.querySelector('input');
    cb.checked = l.enabled;
    cb.addEventListener('change', async () => {
      l.enabled = cb.checked;
      await saveState(state);
      render();
    });
    label.querySelector('.name').textContent = l.name;
    const active = l.rules.filter((r) => r.enabled).length;
    label.querySelector('.count').textContent = `${active}/${l.rules.length} regras`;
    box.append(label);
  }
}

$('globalToggle').addEventListener('change', async (e) => {
  state.enabled = e.target.checked;
  await saveState(state);
  render();
});

$('redirectNow').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'redirect-tab', tabId: tab.id });
  window.close();
});

$('applyAll').addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'redirect-all' });
  $('applyAll').textContent = `${res?.count ?? 0} aba(s) redirecionada(s)`;
  setTimeout(render, 300);
});

$('addList').addEventListener('change', () => {
  $('newListName').hidden = $('addList').value !== '__new';
  if (!$('newListName').hidden) $('newListName').focus();
});

$('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const rule = newRule({
    matchType: 'domain',
    from: $('addFrom').value.trim(),
    to: $('addTo').value.trim(),
    keepPath: $('addKeepPath').checked,
    mode: $('addMode').value,
  });
  const problems = validateRule(rule);
  if (problems.some((p) => !p.startsWith('Atenção'))) {
    $('status').textContent = problems.join(' ');
    $('status').style.color = 'var(--danger)';
    return;
  }
  let listId = $('addList').value;
  if (listId === '__new' || !state.lists.length) {
    const name = $('newListName').value.trim() || 'Nova lista';
    const l = newList({ name });
    $('newListName').value = '';
    state.lists.push(l);
    listId = l.id;
  }
  state.lists.find((l) => l.id === listId).rules.push(rule);
  await saveState(state);
  $('addTo').value = '';
  $('status').style.color = 'var(--ok)';
  $('status').textContent = problems[0] || 'Regra adicionada.';
  $('addList').value = listId;
  render();
});

render();
