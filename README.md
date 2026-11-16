# Reder – Redirecionador de sites (Chrome / Edge)

Extensão que redireciona um site para outro assim que ele é aberto (**automático**) ou quando você pede (**manual**), organizada em **listas de regras** `x → y`, `z → w`…

## Instalação (sem loja)

1. Baixe/clone este repositório.
2. Abra `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
3. Ative o **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** / **Carregar descompactada** e escolha a pasta `extension/`.
5. Fixe o ícone na barra para acesso rápido.

## Como usar

- **Popup (ícone)**: liga/desliga tudo, mostra se a página atual tem regra, botão **Redirecionar agora**, adicionar regra rápida para o site atual, ligar/desligar listas, **Aplicar nas abas abertas**.
- **Gerenciar regras** (página de opções):
  - Várias listas, cada uma pode ser ligada/desligada.
  - Cada regra: tipo, origem → destino, “manter caminho”, modo Automático/Manual.
  - **Adicionar várias de uma vez** colando linhas `origem -> destino` (aceita também `=>`, `→` ou TAB).
  - **Testar uma URL** para ver qual regra se aplica.
  - **Exportar/Importar** em JSON.
- **Botão direito** na página: “Redirecionar esta página agora” e “Criar regra para este site…”.
- **Atalho**: `Alt+Shift+R` redireciona a aba atual (mude em `chrome://extensions/shortcuts`).

### Tipos de regra

| Tipo | Origem (exemplo) | Destino (exemplo) |
|---|---|---|
| Domínio + subdomínios | `x.com` | `y.com` |
| URL começa com | `https://x.com/news/` | `https://y.com/` |
| URL exata | `https://x.com/pagina` | `https://y.com/outra` |
| Curinga | `*.wikipedia.org/wiki/*` | `https://pt.wikipedia.org/wiki/$2` |
| Expressão regular (RE2) | `^https?://(www\.)?youtube\.com/shorts/(.*)` | `https://www.youtube.com/watch?v=$2` |

“Manter caminho” (Domínio / Começa com) leva `x.com/abc?q=1` para `y.com/abc?q=1`.

### Modos

- **Automático**: o próprio navegador redireciona antes da página carregar (API `declarativeNetRequest`).
- **Manual**: nada acontece sozinho; o ícone mostra **M** e você redireciona pelo popup, menu de contexto ou atalho.

A primeira regra que corresponder vence (de cima para baixo, primeira lista primeiro). Na página de opções dá para arrastar as regras pelo `⋮⋮`.

## Desenvolvimento

```bash
node --test tests/*.test.mjs   # testes da lógica de regras
```

Estrutura: `extension/manifest.json`, `background.js` (service worker), `lib/rules.js` (lógica compartilhada), `popup.*`, `options.*`.
