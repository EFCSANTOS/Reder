import {
  STORAGE_KEY,
  loadState,
  saveState,
  defaultState,
  activeRules,
  compileRule,
  findMatch,
} from './lib/rules.js';

// ---------------------------------------------------------------------------
// Sincroniza as regras automáticas com declarativeNetRequest
// ---------------------------------------------------------------------------

let syncing = Promise.resolve();

function scheduleSync() {
  syncing = syncing.then(syncRules).catch((e) => console.error('[Reder] sync', e));
  return syncing;
}

async function syncRules() {
  const state = await loadState();
  const entries = activeRules(state, { includeManual: false });
  const errors = {};
  const addRules = [];
  const sourceRule = {}; // id DNR -> id da regra

  for (const { rule } of entries) {
    let compiled;
    try {
      compiled = compileRule(rule);
    } catch (e) {
      errors[rule.id] = e.message;
      continue;
    }
    const supported = await chrome.declarativeNetRequest.isRegexSupported({
      regex: compiled.regex,
      isCaseSensitive: false,
    });
    if (!supported.isSupported) {
      errors[rule.id] =
        supported.reason === 'memoryLimitExceeded'
          ? 'Expressão regular muito grande.'
          : 'Expressão regular não suportada pelo navegador (RE2).';
      continue;
    }
    sourceRule[addRules.length + 1] = rule.id;
    addRules.push({
      id: addRules.length + 1,
      priority: entries.length - addRules.length, // primeira regra = maior prioridade
      action: { type: 'redirect', redirect: { regexSubstitution: compiled.substitution } },
      condition: {
        regexFilter: compiled.regex,
        isUrlFilterCaseSensitive: false,
        resourceTypes: ['main_frame'],
      },
    });
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map((r) => r.id);

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    // Se uma regra específica derrubar o lote, tenta uma a uma.
    console.warn('[Reder] lote falhou, tentando individualmente', e);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    for (const r of addRules) {
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [r] });
      } catch (err) {
        errors[sourceRule[r.id]] = String(err.message || err);
      }
    }
  }

  await chrome.storage.session.set({ reder_errors: errors });
  await updateBadgeAll(state);
}

// ---------------------------------------------------------------------------
// Badge: "OFF" quando desligado, "M" quando a aba tem uma regra manual
// ---------------------------------------------------------------------------

async function updateBadge(tab, state) {
  if (!tab?.id) return;
  if (!state.enabled) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: 'OFF' });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#6b7280' });
    return;
  }
  const match = tab.url ? findMatch(state, tab.url) : null;
  const text = match ? (match.rule.mode === 'manual' ? 'M' : '→') : '';
  await chrome.action.setBadgeText({ tabId: tab.id, text });
  if (text) await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#2563eb' });
  await chrome.action.setTitle({
    tabId: tab.id,
    title: match ? `Reder: ${match.rule.mode === 'manual' ? 'clique para redirecionar' : 'regra ativa'} → ${match.target}` : 'Reder',
  });
}

async function updateBadgeAll(state) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => updateBadge(t, state).catch(() => {})));
}

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url || info.status === 'complete') updateBadge(tab, await loadState()).catch(() => {});
});

// ---------------------------------------------------------------------------
// Redirecionamento manual (popup, atalho, menu de contexto)
// ---------------------------------------------------------------------------

async function redirectTab(tab, state) {
  state ??= await loadState();
  if (!tab?.url) return null;
  const match = findMatch(state, tab.url);
  if (!match) return null;
  await chrome.tabs.update(tab.id, { url: match.target });
  return match.target;
}

async function redirectAllTabs() {
  const state = await loadState();
  const tabs = await chrome.tabs.query({});
  let count = 0;
  for (const tab of tabs) {
    if (await redirectTab(tab, state)) count++;
  }
  return count;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'redirect-tab': {
        const tab = await chrome.tabs.get(msg.tabId);
        return { target: await redirectTab(tab) };
      }
      case 'redirect-all':
        return { count: await redirectAllTabs() };
      case 'sync':
        await scheduleSync();
        return { ok: true };
      default:
        return { error: 'mensagem desconhecida' };
    }
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ error: String(e.message || e) }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'redirect-current') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await redirectTab(tab);
  } else if (command === 'redirect-all') {
    await redirectAllTabs();
  }
});

// Menu de contexto
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'reder-redirect',
      title: 'Redirecionar esta página agora',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    chrome.contextMenus.create({
      id: 'reder-add',
      title: 'Criar regra de redirecionamento para este site…',
      contexts: ['page'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
    chrome.contextMenus.create({
      id: 'reder-add-link',
      title: 'Criar regra para o site deste link…',
      contexts: ['link'],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'reder-redirect') {
    await redirectTab(tab);
  } else if (info.menuItemId === 'reder-add' || info.menuItemId === 'reder-add-link') {
    const url = info.menuItemId === 'reder-add-link' ? info.linkUrl : tab?.url;
    const from = url ? new URL(url).hostname : '';
    chrome.tabs.create({ url: chrome.runtime.getURL(`options.html?add=${encodeURIComponent(from)}`) });
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  if (!data[STORAGE_KEY]) await saveState(defaultState());
  createMenus();
  scheduleSync();
});

chrome.runtime.onStartup.addListener(() => {
  createMenus();
  scheduleSync();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) scheduleSync();
});
