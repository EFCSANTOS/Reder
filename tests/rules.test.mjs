import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRule, redirectFor, findMatch, parseBulk, validateRule, compileRule } from '../extension/lib/rules.js';

const r = (p) => newRule(p);

test('domínio simples', () => {
  const rule = r({ from: 'x.com', to: 'y.com' });
  assert.equal(redirectFor(rule, 'https://x.com/'), 'https://y.com');
  assert.equal(redirectFor(rule, 'https://www.x.com/abc?q=1'), 'https://y.com');
  assert.equal(redirectFor(rule, 'http://m.x.com:8080/'), 'https://y.com');
  assert.equal(redirectFor(rule, 'https://notx.com/'), null);
  assert.equal(redirectFor(rule, 'https://x.com.br/'), null);
  assert.equal(redirectFor(rule, 'https://y.com/?u=x.com'), null);
});

test('domínio mantendo caminho', () => {
  const rule = r({ from: 'https://www.reddit.com/', to: 'https://old.reddit.com/', keepPath: true });
  assert.equal(redirectFor(rule, 'https://www.reddit.com/r/brasil?x=1'), 'https://old.reddit.com/r/brasil?x=1');
});

test('prefixo', () => {
  const rule = r({ matchType: 'prefix', from: 'https://x.com/news/', to: 'https://y.com/n/', keepPath: true });
  assert.equal(redirectFor(rule, 'https://x.com/news/123'), 'https://y.com/n/123');
  assert.equal(redirectFor(rule, 'https://x.com/other'), null);
});

test('exata', () => {
  const rule = r({ matchType: 'exact', from: 'https://x.com', to: 'https://y.com/z' });
  assert.equal(redirectFor(rule, 'https://x.com/'), 'https://y.com/z');
  assert.equal(redirectFor(rule, 'https://x.com/a'), null);
});

test('curinga', () => {
  const rule = r({ matchType: 'wildcard', from: '*.wikipedia.org/wiki/*', to: 'https://pt.wikipedia.org/wiki/$2' });
  assert.equal(redirectFor(rule, 'https://en.wikipedia.org/wiki/Brazil'), 'https://pt.wikipedia.org/wiki/Brazil');
});

test('regex', () => {
  const rule = r({ matchType: 'regex', from: '^https?://(www\\.)?youtube\\.com/shorts/(.*)', to: 'https://www.youtube.com/watch?v=$2' });
  assert.equal(redirectFor(rule, 'https://www.youtube.com/shorts/abc123'), 'https://www.youtube.com/watch?v=abc123');
  assert.equal(compileRule(rule).substitution, 'https://www.youtube.com/watch?v=\\2');
});

test('prioridade, listas e modos', () => {
  const state = {
    enabled: true,
    lists: [
      { id: 'a', name: 'A', enabled: false, rules: [r({ from: 'x.com', to: 'a.com' })] },
      { id: 'b', name: 'B', enabled: true, rules: [r({ from: 'x.com', to: 'b.com', mode: 'manual' }), r({ from: 'x.com', to: 'c.com' })] },
    ],
  };
  assert.equal(findMatch(state, 'https://x.com/').target, 'https://b.com');
  assert.equal(findMatch(state, 'https://x.com/', { includeManual: false }).target, 'https://c.com');
  assert.equal(findMatch({ ...state, enabled: false }, 'https://x.com/'), null);
});

test('lista em massa', () => {
  const rules = parseBulk('x.com -> y.com\n# comentário\nz.com => w.com\na.com → b.com\nlinha ruim');
  assert.deepEqual(rules.map((x) => [x.from, x.to]), [['x.com', 'y.com'], ['z.com', 'w.com'], ['a.com', 'b.com']]);
});

test('detecção de laço', () => {
  assert.match(validateRule(r({ from: 'x.com', to: 'www.x.com' })).join(), /laço/);
  assert.deepEqual(validateRule(r({ from: 'x.com', to: 'y.com' })), []);
});
