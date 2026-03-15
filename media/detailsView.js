const vscode = acquireVsCodeApi();

const app = document.getElementById('app');

window.addEventListener('message', event => {
  const { type, state } = event.data;
  if (type !== 'state') {
    return;
  }

  vscode.setState(state);
  render(state);
});

const existingState = vscode.getState();
if (existingState) {
  render(existingState);
}

function render(state) {
  if (state.status === 'welcome' || state.status === 'needs-init') {
    app.innerHTML = `
      <section class="shell status-${escapeHtml(state.status)}">
        <header class="hero">
          <p class="eyebrow">Enhanced Hover</p>
          <h1>${escapeHtml(state.title)}</h1>
          ${state.subtitle ? `<p class="subtitle">${escapeHtml(state.subtitle)}</p>` : ''}
        </header>
      </section>
    `;
    return;
  }

  const kindMatch = state.title.match(/^(.+)$/);
  const displayTitle = kindMatch ? kindMatch[1] : state.title;

  app.innerHTML = `
    <section class="shell status-${escapeHtml(state.status)}">
      <header class="hero">
        <span class="symbol-badge">${escapeHtml(displayTitle)}</span>
      </header>
      ${renderBody(state)}
    </section>
  `;
}

function renderBody(state) {
  if (state.status === 'loading' && !state.detailMarkdown) {
    return `
      <div class="loading-indicator">
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
        <div class="loading-dot"></div>
      </div>
    `;
  }

  const md = state.detailMarkdown ?? '';
  if (!md) {
    return '';
  }

  return `<article class="markdown-body">${renderMarkdown(md)}</article>`;
}

function renderMarkdown(markdown) {
  if (!markdown) {
    return '';
  }

  const lines = markdown.split(/\r?\n/);
  const parts = [];
  let inList = false;
  let inCode = false;
  let codeLang = '';
  const codeLines = [];

  const flushList = () => {
    if (inList) {
      parts.push('</ul>');
      inList = false;
    }
  };

  const flushCode = () => {
    if (inCode) {
      const langClass = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : '';
      const raw = codeLines.join('\n');
      parts.push(`<pre><code${langClass}>${highlightCode(raw, codeLang)}</code></pre>`);
      codeLines.length = 0;
      codeLang = '';
      inCode = false;
    }
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      flushList();
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.replace(/^```\s*/, '').trim();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    // Heading
    if (/^#{1,4}\s+/.test(line)) {
      flushList();
      const hashes = line.match(/^#+/)[0].length;
      const level = Math.min(4, hashes);
      const text = line.replace(/^#{1,4}\s+/, '');
      parts.push(`<h${level + 1}>${inlineFormat(text)}</h${level + 1}>`);
      continue;
    }

    // Line that looks like a file path + line range label (e.g. "171:184:d:\path\file.ts")
    if (/^\d+:\d+:.+\.\w+$/.test(line.trim())) {
      flushList();
      parts.push(`<p class="file-label">${escapeHtml(line.trim())}</p>`);
      continue;
    }

    // List items (-, *, or numbered)
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        parts.push('<ul>');
        inList = true;
      }
      parts.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }

    flushList();
    if (line.trim().length === 0) {
      continue;
    }

    parts.push(`<p>${inlineFormat(line)}</p>`);
  }

  flushList();
  flushCode();
  return parts.join('');
}

/** Handle inline formatting: bold, inline code, and basic link-like text */
function inlineFormat(text) {
  let result = escapeHtml(text);
  // Bold: **text**
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Inline code: `text`
  result = result.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  return result;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Lightweight syntax highlighter for TypeScript/JavaScript and Python.
 * Produces <span class="tok-*"> wrappers matching VS Code Dark+/Light+ token colors.
 */
function highlightCode(code, lang) {
  const isTS = /^(typescript|typescriptreact|javascript|javascriptreact|tsx?|jsx?)$/i.test(lang);
  const isPy = /^python$/i.test(lang);

  if (!isTS && !isPy) return escapeHtml(code);

  let tokenPattern;
  let groupClasses;

  if (isTS) {
    tokenPattern = new RegExp([
      '(\\/\\/[^\\n]*)',                                                     // 1: line comment
      '(\\/\\*[\\s\\S]*?\\*\\/)',                                            // 2: block comment
      '(`(?:[^`\\\\]|\\\\[\\s\\S])*`)',                                      // 3: template literal
      '("(?:[^"\\\\\\n]|\\\\.)*")',                                          // 4: double string
      "('(?:[^'\\\\\\n]|\\\\.)*')",                                          // 5: single string
      '(\\b(?:abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|false|finally|for|from|function|if|implements|import|in|instanceof|interface|is|keyof|let|module|namespace|new|null|of|readonly|return|static|super|switch|this|throw|true|try|type|typeof|undefined|var|void|while|yield)\\b)', // 6: keyword
      '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',                         // 7: number
      '(\\b[A-Z][a-zA-Z0-9]*\\b)',                                           // 8: PascalCase type
      '(\\b[a-z_$][a-zA-Z0-9_$]*(?=\\s*\\())',                              // 9: function call
    ].join('|'), 'gm');
    groupClasses = ['', 'tok-comment', 'tok-comment', 'tok-string', 'tok-string', 'tok-string', 'tok-keyword', 'tok-number', 'tok-type', 'tok-fn'];
  } else {
    tokenPattern = new RegExp([
      '(#[^\\n]*)',                                                          // 1: comment
      '("""[\\s\\S]*?""")',                                                  // 2: triple double string
      "('''[\\s\\S]*?''')",                                                  // 3: triple single string
      '("(?:[^"\\\\\\n]|\\\\.)*")',                                          // 4: double string
      "('(?:[^'\\\\\\n]|\\\\.)*')",                                          // 5: single string
      '(\\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|self|True|try|while|with|yield)\\b)', // 6: keyword
      '(\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)',                         // 7: number
      '(@\\w+)',                                                              // 8: decorator
      '(\\b[A-Z][a-zA-Z0-9_]*\\b)',                                          // 9: PascalCase type
      '(\\b[a-z_][a-zA-Z0-9_]*(?=\\s*\\())',                                // 10: function call
    ].join('|'), 'gm');
    groupClasses = ['', 'tok-comment', 'tok-string', 'tok-string', 'tok-string', 'tok-string', 'tok-keyword', 'tok-number', 'tok-decorator', 'tok-type', 'tok-fn'];
  }

  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(code)) !== null) {
    if (match.index > lastIndex) {
      result += escapeHtml(code.slice(lastIndex, match.index));
    }

    let cls = '';
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        cls = groupClasses[i] || '';
        break;
      }
    }

    if (cls) {
      result += '<span class="' + cls + '">' + escapeHtml(match[0]) + '</span>';
    } else {
      result += escapeHtml(match[0]);
    }

    lastIndex = tokenPattern.lastIndex;
  }

  if (lastIndex < code.length) {
    result += escapeHtml(code.slice(lastIndex));
  }

  return result;
}
