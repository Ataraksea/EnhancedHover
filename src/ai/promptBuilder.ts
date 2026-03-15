import type { PromptSpec, SymbolContext } from '../types';

function getFileName(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function buildContextBlock(context: SymbolContext): string {
  const sections: string[] = [
    `Symbol: ${context.symbolName}`,
    `Language: ${context.languageId}`,
    `Kind: ${context.symbolKind ?? 'unknown'}`,
    `Container: ${context.containerName ?? 'unknown'}`
  ];

  if (context.hoverTexts.length > 0) {
    sections.push(`Hover Text:\n${context.hoverTexts.join('\n---\n')}`);
  }

  if (context.definitionSnippet) {
    sections.push(
      [
        `Definition File: ${context.definitionSnippet.uri.fsPath}`,
        `Definition Start Line: ${context.definitionSnippet.startLine + 1}`,
        'Definition Snippet:',
        context.definitionSnippet.code
      ].join('\n')
    );
  }

  if (context.references.length > 0) {
    const referenceLines = context.references.map(reference => {
      return `${reference.uri.fsPath}:${reference.range.start.line + 1} ${reference.preview}`;
    });

    sections.push(`Reference Previews:\n${referenceLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

function buildDetailContextBlock(context: SymbolContext): string {
  const sections: string[] = [];

  // Identity
  sections.push([
    `Symbol: ${context.symbolName}`,
    `Language: ${context.languageId}`,
    `Kind: ${context.symbolKind ?? 'unknown'}`,
    `Container: ${context.containerName ?? 'top-level'}`
  ].join('\n'));

  // Hover/JSDoc text
  if (context.hoverTexts.length > 0) {
    sections.push(`Hover/JSDoc Text:\n${context.hoverTexts.join('\n---\n')}`);
  }

  // Full definition code
  if (context.definitionSnippet) {
    const defFile = context.definitionSnippet.uri.fsPath;
    const startLine = context.definitionSnippet.startLine + 1;
    const endLine = startLine + context.definitionSnippet.code.split('\n').length - 1;
    sections.push([
      `Definition (${startLine}:${endLine}:${defFile}):`,
      '```' + context.definitionSnippet.languageId,
      context.definitionSnippet.code,
      '```'
    ].join('\n'));
  }

  // Full reference/usage snippets
  if (context.references.length > 0) {
    const refBlocks = context.references.map(ref => {
      const refFile = ref.uri.fsPath;
      const refLine = ref.range.start.line + 1;
      const header = ref.containerName
        ? `Usage in \`${ref.containerName}\` (${getFileName(refFile)}:${refLine}):`
        : `Usage (${getFileName(refFile)}:${refLine}):`;

      if (ref.contextSnippet) {
        const lang = context.languageId;
        const snippetLineCount = ref.contextSnippet.split('\n').length;
        const startLine = ref.snippetStartLine != null ? ref.snippetStartLine + 1 : refLine;
        const endLine = startLine + snippetLineCount - 1;
        const fileLabel = `${startLine}:${endLine}:${refFile}`;
        return `${header}\n${fileLabel}\n\`\`\`${lang}\n${ref.contextSnippet}\n\`\`\``;
      }
      return `${header}\n${ref.preview}`;
    });
    sections.push('Reference Usages:\n' + refBlocks.join('\n\n'));
  }

  return sections.join('\n\n');
}

export function buildSummaryPrompt(context: SymbolContext): PromptSpec {
  return {
    instruction: [
      'You explain code symbols for an editor hover tooltip.',
      'Return exactly 3 bullet lines.',
      'Each bullet must be plain text, concise, and under 120 characters.',
      'Ground every statement in the provided symbol context.',
      'Do not include headings, numbering, markdown fences, or extra commentary.'
    ].join(' '),
    payload: buildContextBlock(context)
  };
}

export function buildDetailPrompt(context: SymbolContext): PromptSpec {
  const symbolLabel = context.symbolKind
    ? `${context.symbolName} (${context.symbolKind.toLowerCase()})`
    : context.symbolName;

  const instruction = `You are a code documentation engine for a VS Code sidebar panel. Produce a thorough, information-dense explanation of the symbol \`${symbolLabel}\`. Use GitHub-flavored markdown.

FORMAT — use exactly these sections in this order. Omit a section only if the context provides zero relevant information for it.

1. Start with a SHORT (1-3 sentence) natural-language description of what the symbol is and does. No heading for this intro.

2. ## Definition
   Show the full source code of the symbol in a fenced code block. Above the code block, show the file path and line range like: \`startLine:endLine:filepath\`. After the code block, list:
   - **Params** (if applicable): each parameter with name, type, and one-line description.
   - **Returns**: what the function returns, with the concrete type.
   - **Side effects** (if applicable): HTTP calls, mutations, I/O, state changes.

3. ## Example Usages
   For each reference/call site in the context, write 1-2 plain-English sentences explaining WHERE and WHY the symbol is used at that location. Then reproduce the code snippet EXACTLY as given in a fenced code block. Above each code block, place the file path and line range on its own line (format: startLine:endLine:filepath). After all examples, add a **Usage Summary** paragraph describing the overall calling pattern, how many callers exist, and the architectural role of the symbol.

4. ## Notes
   Interesting observations: unusual patterns, naming quirks, hidden assumptions, type relationships to other symbols. Be specific and insightful. Do NOT say "information is not available in the provided context" — if you lack info, omit the point silently.

5. ## See Also
   List 2-5 related symbols, types, or functions mentioned in the definition or references. For each, give the name and a one-line description of its relationship to this symbol.

RULES:
- Ground every claim in the supplied context. Do not fabricate code, file paths, or line numbers.
- Reproduce code blocks EXACTLY as provided; do not reformat, abbreviate, or add comments that are not in the original.
- Use inline code backticks for symbol names, types, and file names in prose.
- Write in concise, direct technical prose. No filler phrases. No "Let's explore" or "It's important to note."
- If the definition code is provided, ALWAYS include it in the Definition section.
- If reference usage snippets are provided, ALWAYS include them in Example Usages.`;

  return {
    instruction,
    payload: buildDetailContextBlock(context)
  };
}
