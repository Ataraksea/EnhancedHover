import * as vscode from 'vscode';

import { EXTENSION_PREFIX } from '../constants';
import type { ModelSelectorSettings } from '../types';

function getConfiguration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(EXTENSION_PREFIX);
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function getPrefetchEnabled(): boolean {
  return getConfiguration().get<boolean>('prefetchEnabled', true);
}

export function getHoverDwellMs(): number {
  return getConfiguration().get<number>('hoverDwellMs', 900);
}

export function getCacheTtlMs(): number {
  return getConfiguration().get<number>('cacheTtlMs', 300_000);
}

export function getMaxContextLines(): number {
  return getConfiguration().get<number>('maxContextLines', 40);
}

export function getRequestTimeoutMs(): number {
  return getConfiguration().get<number>('requestTimeoutMs', 30_000);
}

export function getModelSelectorSettings(): ModelSelectorSettings {
  const modelConfiguration = getConfiguration().get<Record<string, unknown>>('model', {});

  return {
    vendor: readOptionalString(modelConfiguration.vendor),
    family: readOptionalString(modelConfiguration.family),
    id: readOptionalString(modelConfiguration.id),
    version: readOptionalString(modelConfiguration.version)
  };
}

export function getSupportedDocumentSelector(): vscode.DocumentSelector {
  return [
    { language: 'typescript', scheme: 'file' },
    { language: 'typescriptreact', scheme: 'file' },
    { language: 'javascript', scheme: 'file' },
    { language: 'javascriptreact', scheme: 'file' },
    { language: 'python', scheme: 'file' }
  ];
}
