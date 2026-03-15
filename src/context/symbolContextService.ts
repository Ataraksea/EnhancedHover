import * as vscode from 'vscode';

import { getMaxContextLines } from '../config/settings';
import type { DefinitionSnippet, ExplanationMode, SymbolContext, SymbolLocation, SymbolReference } from '../types';

export class SymbolContextService {
  public async getContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    mode: ExplanationMode,
    token: vscode.CancellationToken
  ): Promise<SymbolContext | undefined> {
    const wordRange = document.getWordRangeAtPosition(position) ?? this.createFallbackRange(position);
    const symbolName = document.getText(wordRange).trim();
    if (!symbolName) {
      return undefined;
    }

    const [hoverTexts, definition, containerName, symbolKind, selectionRange, references] = await Promise.all([
      this.getHoverTexts(document, position),
      this.getDefinition(document, position),
      this.getContainerInfo(document, position),
      this.getSymbolKind(document, position),
      this.getSelectionRange(document, position),
      mode === 'detail' ? this.getReferences(document, position, token) : Promise.resolve([])
    ]);

    if (token.isCancellationRequested) {
      return undefined;
    }

    const definitionSnippet = definition ? await this.getDefinitionSnippet(definition) : undefined;
    const key = this.buildKey(document.uri, wordRange, definition ?? { uri: document.uri, range: wordRange }, symbolName);

    return {
      key,
      symbolName,
      symbolKind,
      containerName,
      languageId: document.languageId,
      sourceUri: document.uri,
      wordRange,
      hoverTexts,
      selectionRange,
      definition,
      definitionSnippet,
      references
    };
  }

  private createFallbackRange(position: vscode.Position): vscode.Range {
    return new vscode.Range(position, position.translate(0, 1));
  }

  private async getHoverTexts(document: vscode.TextDocument, position: vscode.Position): Promise<string[]> {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      position
    );

    return (hovers ?? [])
      .flatMap((hover: vscode.Hover) => hover.contents)
      .map((content: vscode.MarkdownString | vscode.MarkedString) => this.renderHoverContent(content))
      .filter((text: string) => text.length > 0)
      .slice(0, 3);
  }

  private renderHoverContent(content: vscode.MarkdownString | vscode.MarkedString): string {
    if (typeof content === 'string') {
      return content.trim();
    }

    if ('value' in content && typeof content.value === 'string') {
      return content.value.replace(/```[\s\S]*?```/g, '').replace(/[#>*_`]/g, '').trim();
    }

    return content.value.trim();
  }

  private async getDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<SymbolLocation | undefined> {
    const definition = await vscode.commands.executeCommand<vscode.Definition | vscode.LocationLink[]>(
      'vscode.executeDefinitionProvider',
      document.uri,
      position
    );

    return this.normalizeDefinition(definition);
  }

  private normalizeDefinition(
    definition: vscode.Definition | vscode.LocationLink[] | undefined
  ): SymbolLocation | undefined {
    if (!definition) {
      return undefined;
    }

    if (Array.isArray(definition)) {
      const first = definition[0];
      if (!first) {
        return undefined;
      }

      if ('targetUri' in first) {
        return {
          uri: first.targetUri,
          range: first.targetSelectionRange ?? first.targetRange
        };
      }

      return {
        uri: first.uri,
        range: first.range
      };
    }

    return {
      uri: definition.uri,
      range: definition.range
    };
  }

  private async getContainerInfo(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<string | undefined> {
    const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols || symbols.length === 0) {
      return undefined;
    }

    const container = this.findContainingSymbol(symbols, position);
    return container?.name;
  }

  private async getSymbolKind(document: vscode.TextDocument, position: vscode.Position): Promise<string | undefined> {
    const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri
    );

    if (!symbols || symbols.length === 0) {
      return undefined;
    }

    const symbol = this.findContainingSymbol(symbols, position);
    return symbol ? vscode.SymbolKind[symbol.kind] : undefined;
  }

  private findContainingSymbol(
    symbols: (vscode.DocumentSymbol | vscode.SymbolInformation)[],
    position: vscode.Position
  ): vscode.DocumentSymbol | vscode.SymbolInformation | undefined {
    for (const symbol of symbols) {
      const range = symbol instanceof vscode.DocumentSymbol ? symbol.range : symbol.location.range;
      if (!range.contains(position)) {
        continue;
      }

      if (symbol instanceof vscode.DocumentSymbol) {
        const child = this.findContainingSymbol(symbol.children, position);
        return child ?? symbol;
      }

      return symbol;
    }

    return undefined;
  }

  private async getSelectionRange(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Range | undefined> {
    const selectionRanges = await vscode.commands.executeCommand<vscode.SelectionRange[]>(
      'vscode.executeSelectionRangeProvider',
      document.uri,
      [position]
    );

    return selectionRanges?.[0]?.range;
  }

  private async getReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<SymbolReference[]> {
    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      position
    );

    if (!references || token.isCancellationRequested) {
      return [];
    }

    // Deduplicate by file+line so we don't show the same call site twice
    const seen = new Set<string>();
    const unique: vscode.Location[] = [];
    for (const ref of references) {
      const key = `${ref.uri.toString()}:${ref.range.start.line}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(ref);
      }
    }

    // Filter out the definition itself, keep up to 8 references
    const definitionLine = document.getWordRangeAtPosition(position)?.start.line ?? position.line;
    const filtered = unique.filter(ref =>
      !(ref.uri.toString() === document.uri.toString() && ref.range.start.line === definitionLine)
    ).slice(0, 8);

    const previews = await Promise.all(
      filtered.map((reference: vscode.Location) => this.getReferencePreview(reference))
    );
    return previews.filter(
      (reference: SymbolReference | undefined): reference is SymbolReference => reference !== undefined
    );
  }

  private async getReferencePreview(reference: vscode.Location): Promise<SymbolReference | undefined> {
    const document = await vscode.workspace.openTextDocument(reference.uri);
    const refLine = reference.range.start.line;
    const line = document.lineAt(refLine).text.trim();

    // Gather a multi-line context snippet around the reference (up to 12 lines)
    const contextRadius = 5;
    const startLine = Math.max(0, refLine - contextRadius);
    const endLine = Math.min(document.lineCount - 1, refLine + contextRadius);
    const snippetLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      snippetLines.push(document.lineAt(i).text);
    }
    const contextSnippet = snippetLines.join('\n');

    // Try to find the containing function/class name for this reference
    let containerName: string | undefined;
    const symbols = await vscode.commands.executeCommand<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
      'vscode.executeDocumentSymbolProvider',
      reference.uri
    );
    if (symbols) {
      const container = this.findContainingSymbol(symbols, new vscode.Position(refLine, reference.range.start.character));
      containerName = container?.name;
    }

    return {
      uri: reference.uri,
      range: reference.range,
      preview: line.slice(0, 160),
      contextSnippet,
      snippetStartLine: startLine,
      containerName
    };
  }

  private async getDefinitionSnippet(definition: SymbolLocation): Promise<DefinitionSnippet | undefined> {
    const document = await vscode.workspace.openTextDocument(definition.uri);
    const maxContextLines = getMaxContextLines();
    const halfWindow = Math.max(4, Math.floor(maxContextLines / 2));
    const startLine = Math.max(0, definition.range.start.line - halfWindow);
    const endLine = Math.min(document.lineCount - 1, definition.range.end.line + halfWindow);
    const start = new vscode.Position(startLine, 0);
    const end = new vscode.Position(endLine, document.lineAt(endLine).text.length);

    return {
      uri: definition.uri,
      languageId: document.languageId,
      range: definition.range,
      startLine,
      code: document.getText(new vscode.Range(start, end))
    };
  }

  private buildKey(
    sourceUri: vscode.Uri,
    wordRange: vscode.Range,
    definition: SymbolLocation,
    symbolName: string
  ): string {
    const definitionPart = `${definition.uri.toString()}:${definition.range.start.line}:${definition.range.start.character}`;
    const sourcePart = `${sourceUri.toString()}:${wordRange.start.line}:${wordRange.start.character}`;
    return `${symbolName}::${definitionPart}::${sourcePart}`;
  }
}
