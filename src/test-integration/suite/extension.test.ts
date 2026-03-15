import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Enhanced Hover Integration', () => {
  const fixtureDir = path.resolve(__dirname, '../../../test-fixtures');

  suiteSetup(async function () {
    this.timeout(30_000);
    // Wait for the extension to activate by opening a TS file
    const uri = vscode.Uri.file(path.join(fixtureDir, 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    // Give the extension time to activate
    await sleep(3000);
  });

  test('extension activates and registers commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('enhancedHover.openDetails'), 'openDetails command should be registered');
    assert.ok(commands.includes('enhancedHover.diagnose'), 'diagnose command should be registered');
    assert.ok(commands.includes('enhancedHover.initializeAiAccess'), 'initializeAiAccess command should be registered');
    assert.ok(commands.includes('enhancedHover.refreshCurrentSymbol'), 'refreshCurrentSymbol command should be registered');
  });

  test('hover provider returns content for a symbol', async function () {
    this.timeout(15_000);
    const uri = vscode.Uri.file(path.join(fixtureDir, 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    // Position on the function name "greet" at line 0, char 16
    const position = new vscode.Position(0, 16);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      position
    );

    console.log(`[TEST] Hovers returned: ${hovers?.length ?? 0}`);
    if (hovers) {
      for (const hover of hovers) {
        for (const content of hover.contents) {
          const text = typeof content === 'string' ? content : (content as vscode.MarkdownString).value;
          console.log(`[TEST] Hover content: ${text.substring(0, 200)}`);
        }
      }
    }

    // We expect at least the built-in TS hover, plus our enhanced hover
    assert.ok(hovers && hovers.length > 0, 'Should have at least one hover result');
  });

  test('symbol context service gathers context', async function () {
    this.timeout(15_000);
    const uri = vscode.Uri.file(path.join(fixtureDir, 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
    const position = new vscode.Position(0, 16);

    // Test individual provider commands used by SymbolContextService
    console.log('[TEST] Testing executeHoverProvider...');
    const hoverResult = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', doc.uri, position
    );
    console.log(`[TEST] Hover results: ${hoverResult?.length ?? 0}`);

    console.log('[TEST] Testing executeDefinitionProvider...');
    const defResult = await vscode.commands.executeCommand<vscode.Definition>(
      'vscode.executeDefinitionProvider', doc.uri, position
    );
    console.log(`[TEST] Definition result: ${JSON.stringify(defResult)?.substring(0, 200)}`);

    console.log('[TEST] Testing executeDocumentSymbolProvider...');
    const symbolResult = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider', doc.uri
    );
    console.log(`[TEST] Document symbols: ${symbolResult?.length ?? 0}`);
    if (symbolResult) {
      for (const s of symbolResult) {
        console.log(`[TEST]   symbol: ${s.name} kind=${vscode.SymbolKind[s.kind]} range=${s.range.start.line}:${s.range.start.character}-${s.range.end.line}:${s.range.end.character}`);
      }
    }

    assert.ok(hoverResult && hoverResult.length > 0, 'Hover should return results');
  });

  test('openDetails command runs without throwing', async function () {
    this.timeout(30_000);
    const uri = vscode.Uri.file(path.join(fixtureDir, 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    // Place cursor on "greet"
    const position = new vscode.Position(0, 16);
    editor.selection = new vscode.Selection(position, position);

    console.log('[TEST] Executing enhancedHover.openDetails...');
    try {
      await vscode.commands.executeCommand('enhancedHover.openDetails', {
        uri: doc.uri.toString(),
        line: position.line,
        character: position.character
      });
      console.log('[TEST] openDetails command completed successfully.');
    } catch (error) {
      console.error('[TEST] openDetails command threw:', error);
      throw error;
    }

    // Give the command time to process
    await sleep(2000);
    console.log('[TEST] openDetails test done.');
  });

  test('diagnose command runs without throwing', async function () {
    this.timeout(30_000);
    const uri = vscode.Uri.file(path.join(fixtureDir, 'sample.ts'));
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);

    // Place cursor on "greet"
    const position = new vscode.Position(0, 16);
    editor.selection = new vscode.Selection(position, position);

    console.log('[TEST] Executing enhancedHover.diagnose...');
    try {
      await vscode.commands.executeCommand('enhancedHover.diagnose');
      console.log('[TEST] diagnose command completed successfully.');
    } catch (error) {
      console.error('[TEST] diagnose command threw:', error);
      throw error;
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
