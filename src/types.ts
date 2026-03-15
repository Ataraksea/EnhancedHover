import type * as vscode from 'vscode';

export type ExplanationMode = 'summary' | 'detail';

export interface OpenSymbolRequest {
  uri: string;
  line: number;
  character: number;
}

export interface SymbolLocation {
  uri: vscode.Uri;
  range: vscode.Range;
}

export interface DefinitionSnippet {
  uri: vscode.Uri;
  languageId: string;
  range: vscode.Range;
  startLine: number;
  code: string;
}

export interface SymbolReference {
  uri: vscode.Uri;
  range: vscode.Range;
  preview: string;
  contextSnippet?: string;
  snippetStartLine?: number;
  containerName?: string;
}

export interface SymbolContext {
  key: string;
  symbolName: string;
  symbolKind?: string;
  containerName?: string;
  languageId: string;
  sourceUri: vscode.Uri;
  wordRange: vscode.Range;
  hoverTexts: string[];
  selectionRange?: vscode.Range;
  definition?: SymbolLocation;
  definitionSnippet?: DefinitionSnippet;
  references: SymbolReference[];
}

export interface ExplanationRecord {
  key: string;
  summary: string[];
  detailMarkdown?: string;
  createdAt: number;
  sourceVersion: number;
}

export interface ModelSelectorSettings {
  vendor?: string;
  family?: string;
  id?: string;
  version?: string;
}

export interface PromptSpec {
  instruction: string;
  payload: string;
}
