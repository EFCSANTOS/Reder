// Lógica compartilhada: modelo de dados, compilação de regras e correspondência.
// Usado pelo service worker, pelo popup e pela página de opções.

export const STORAGE_KEY = 'reder';

export const MATCH_TYPES = {
  domain: 'Domínio + subdomínios',
  prefix: 'URL começa com',
  exact: 'URL exata',
  wildcard: 'Curinga (*)',
  regex: 'Expressão regular',
};

export const MODES = {
  auto: 'Automático',
  manual: 'Manual',
};

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function newRule(partial = {}) {
  return {
    id: uid(),
    enabled: true,
    matchType: 'domain',
    from: '',
    to: '',
    keepPath: false,
    mode: 'auto',
    ...partial,
  };
}

export function newList(partial = {}) {
  return { id: uid(), name: 'Nova lista', enabled: true, rules: [], ...partial };
}

export function defaultState() {
  return { enabled: true, lists: [newList({ name: 'Minha lista' })] };
}

export function normalizeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : defaultState();
  return {
    enabled: state.enabled !== false,
    lists: (Array.isArray(state.lists) ? state.lists : []).map((l) => ({
      ...newList(),
      ...l,
      rules: (Array.isArray(l.rules) ? l.rules : []).map((r) => ({ ...newRule(), ...r })),
    })),
  };
}

export async function loadState() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeState(data[STORAGE_KEY]);
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizeState(state) });
}

/** Regras ativas, na ordem de prioridade (primeira lista / primeira regra vence). */
export function activeRules(state, { includeManual = true } = {}) {
  if (!state.enabled) return [];
  const out = [];
  for (const list of state.lists) {
    if (!list.enabled) continue;
    for (const rule of list.rules) {
      if (!rule.enabled || !rule.from.trim() || !rule.to.trim()) continue;
      if (!includeManual && rule.mode === 'manual') continue;
      out.push({ rule, list });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compilação: cada regra vira { regex, substitution } compatível com RE2
// (declarativeNetRequest) e com RegExp do JavaScript.
// A substituição usa a sintaxe do Chrome: \1 .. \9 (e \0 = URL inteira).
// ---------------------------------------------------------------------------

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escapeRe = (s) => s.replace(RE_SPECIAL, '\\$&');
const hasScheme = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

/** "y.com" -> "https://y.com" */
export function normalizeTarget(to) {
  const t = to.trim();
  if (!t) return t;
  return hasScheme(t) ? t : 'https://' + t;
}

/** Extrai o host de "https://www.x.com/abc", "x.com/abc", "*.x.com" etc. */
export function extractHost(input) {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^\*\./, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  s = s.replace(/:\d+$/, '');
  return s;
}

/** Escapa um texto literal para uso na substituição (\ é especial). */
const escapeSub = (s) => s.replace(/\\/g, '\\\\');

/** Converte $1..$9 (estilo JS) em \1..\9 (estilo Chrome), mantendo \N. */
function dollarToBackslash(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && /[0-9\\]/.test(s[i + 1] ?? '')) {
      out += c + s[++i];
    } else if (c === '$' && /[0-9]/.test(s[i + 1] ?? '')) {
      out += '\\' + s[++i];
    } else if (c === '$' && s[i + 1] === '$') {
      out += '$';
      i++;
    } else if (c === '\\') {
      out += '\\\\';
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * Compila uma regra. Retorna { regex, substitution } ou lança Error com
 * mensagem amigável.
 */
export function compileRule(rule) {
  const from = rule.from.trim();
  const target = normalizeTarget(rule.to);
  if (!from) throw new Error('Informe a origem.');
  if (!target) throw new Error('Informe o destino.');

  switch (rule.matchType) {
    case 'domain': {
      const host = extractHost(from);
      if (!host || /[\s*]/.test(host)) throw new Error('Domínio inválido.');
      const regex = `^https?://(?:[^/?#@]*\\.)?${escapeRe(host)}(?::[0-9]+)?(/.*)?$`;
      const substitution = rule.keepPath
        ? escapeSub(target.replace(/\/+$/, '')) + '\\1'
        : escapeSub(target);
      return { regex, substitution };
    }
    case 'prefix': {
      const base = hasScheme(from) ? escapeRe(from) : 'https?://' + escapeRe(from);
      const regex = `^${base}(.*)$`;
      const substitution = escapeSub(target) + (rule.keepPath ? '\\1' : '');
      return { regex, substitution };
    }
    case 'exact': {
      const stripped = from.replace(/\/+$/, '');
      const base = hasScheme(stripped) ? escapeRe(stripped) : 'https?://' + escapeRe(stripped);
      return { regex: `^${base}/?$`, substitution: escapeSub(target) };
    }
    case 'wildcard': {
      const parts = from.split('*').map(escapeRe);
      if (parts.length - 1 > 9) throw new Error('Máximo de 9 curingas (*).');
      let regex = parts.join('(.*)');
      if (!hasScheme(from) && !from.startsWith('*')) regex = 'https?://' + regex;
      return { regex: `^${regex}$`, substitution: dollarToBackslash(target) };
    }
    case 'regex': {
      try {
        new RegExp(from);
      } catch (e) {
        throw new Error('Expressão regular inválida: ' + e.message);
      }
      return { regex: from, substitution: dollarToBackslash(rule.to.trim()) };
    }
    default:
      throw new Error('Tipo de correspondência desconhecido.');
  }
}

/** Aplica a substituição (sintaxe \N) a um resultado de RegExp.exec. */
export function applySubstitution(substitution, match) {
  let out = '';
  for (let i = 0; i < substitution.length; i++) {
    const c = substitution[i];
    if (c === '\\' && i + 1 < substitution.length) {
      const n = substitution[++i];
      out += /[0-9]/.test(n) ? match[Number(n)] ?? '' : n;
    } else {
      out += c;
    }
  }
  return out;
}

/** Testa uma URL contra uma regra. Retorna a URL de destino ou null. */
export function redirectFor(rule, url) {
  let compiled;
  try {
    compiled = compileRule(rule);
  } catch {
    return null;
  }
  const m = new RegExp(compiled.regex, 'i').exec(url);
  if (!m) return null;
  return applySubstitution(compiled.substitution, m);
}

/** Primeira regra ativa que corresponde à URL. */
export function findMatch(state, url, opts) {
  if (!/^https?:/i.test(url || '')) return null;
  for (const entry of activeRules(state, opts)) {
    const target = redirectFor(entry.rule, url);
    if (target && target !== url) return { ...entry, target };
  }
  return null;
}

/**
 * Valida uma regra: compila, checa destino e detecta laço simples
 * (o destino casaria com a própria origem). Retorna lista de avisos.
 */
export function validateRule(rule) {
  const problems = [];
  if (!rule.from.trim() && !rule.to.trim()) return problems;
  let compiled;
  try {
    compiled = compileRule(rule);
  } catch (e) {
    return [e.message];
  }
  if (rule.matchType !== 'regex' && rule.matchType !== 'wildcard') {
    try {
      const u = new URL(normalizeTarget(rule.to));
      if (!/^https?:$/.test(u.protocol)) problems.push('O destino deve começar com http:// ou https://');
    } catch {
      problems.push('Destino não é uma URL válida.');
    }
  }
  try {
    const t = normalizeTarget(rule.to).replace(/\$\d|\\\d/g, '');
    const probe = /^[a-z]+:\/\/[^/]+$/i.test(t) ? t + '/' : t;
    if (new RegExp(compiled.regex, 'i').test(probe)) {
      problems.push('Atenção: o destino também corresponde à origem (possível laço de redirecionamento).');
    }
  } catch {
    /* ignore */
  }
  return problems;
}

/**
 * Lê texto no formato "origem -> destino" (uma por linha).
 * Aceita separadores: ->, =>, →, tab ou " > ".
 */
export function parseBulk(text, defaults = {}) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s*(?:->|=>|→|\t|\s>\s)\s*/);
    if (parts.length < 2 || !parts[0] || !parts[1]) continue;
    rules.push(newRule({ ...defaults, from: parts[0], to: parts[1] }));
  }
  return rules;
}
