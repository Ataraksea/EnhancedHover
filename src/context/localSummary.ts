import type { SymbolContext } from '../types';

function getFileLabel(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.at(-1) ?? normalized;
}

export function buildLocalSummary(context: SymbolContext): string[] {
  const kindLabel = context.symbolKind ?? 'Symbol';
  const lines = [`${kindLabel} ${context.symbolName} in ${getFileLabel(context.sourceUri.fsPath)}`];

  if (context.containerName) {
    lines.push(`Contained in ${context.containerName}`);
  }

  if (context.definitionSnippet) {
    lines.push(`Definition snippet available from ${getFileLabel(context.definitionSnippet.uri.fsPath)}`);
  } else if (context.definition) {
    lines.push(`Definition resolved in ${getFileLabel(context.definition.uri.fsPath)}`);
  }

  if (context.hoverTexts.length > 0) {
    lines.push(context.hoverTexts[0]);
  }

  return lines.slice(0, 4);
}

export function buildLocalDetailMarkdown(context: SymbolContext): string {
  const lines: string[] = [];

  // Natural language intro (no heading)
  const kindLabel = (context.symbolKind ?? 'Symbol').toLowerCase();
  lines.push(`\`${context.symbolName}\` is a ${kindLabel} in \`${getFileLabel(context.sourceUri.fsPath)}\`.`);

  if (context.hoverTexts.length > 0) {
    lines.push(context.hoverTexts[0]);
  }

  // Definition section
  lines.push('', '## Definition');
  if (context.definitionSnippet) {
    const startLine = context.definitionSnippet.startLine + 1;
    const endLine = startLine + context.definitionSnippet.code.split('\n').length - 1;
    lines.push(`${startLine}:${endLine}:${context.definitionSnippet.uri.fsPath}`);
    lines.push('```' + context.definitionSnippet.languageId);
    lines.push(context.definitionSnippet.code);
    lines.push('```');
  } else if (context.definition) {
    lines.push(`- **File:** \`${context.definition.uri.fsPath}\``);
    lines.push(`- **Line:** ${context.definition.range.start.line + 1}`);
  } else {
    lines.push('Definition source is not available from the current language tooling.');
  }

  // Example Usages
  if (context.references.length > 0) {
    lines.push('', '## Example Usages');
    for (const ref of context.references) {
      const refFile = getFileLabel(ref.uri.fsPath);
      const refLine = ref.range.start.line + 1;
      const label = ref.containerName
        ? `Used in \`${ref.containerName}\` (\`${refFile}:${refLine}\`):`
        : `Reference in \`${refFile}:${refLine}\`:`;
      lines.push(label);
      if (ref.contextSnippet) {
        const snippetLineCount = ref.contextSnippet.split('\n').length;
        const sLine = ref.snippetStartLine != null ? ref.snippetStartLine + 1 : refLine;
        const eLine = sLine + snippetLineCount - 1;
        lines.push(`${sLine}:${eLine}:${ref.uri.fsPath}`);
        lines.push('```' + context.languageId);
        lines.push(ref.contextSnippet);
        lines.push('```');
      } else {
        lines.push(`\`${ref.preview}\``);
      }
    }
  }

  // Notes
  lines.push('', '## Notes');
  lines.push(`- **Language:** ${context.languageId}`);
  lines.push(`- **Kind:** ${context.symbolKind ?? 'unknown'}`);
  lines.push(`- **Container:** ${context.containerName ?? 'top-level'}`);

  return lines.join('\n');
}
