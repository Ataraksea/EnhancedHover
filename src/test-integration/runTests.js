/**
 * Launcher script for integration tests.
 * Downloads VS Code, installs the extension, and runs the inner test suite.
 */
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, '../../out/test-integration/suite/index');
  const testWorkspace = path.resolve(__dirname, '../../test-fixtures');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',
        '--disable-gpu'
      ]
    });
  } catch (error) {
    console.error('Integration tests failed:', error);
    process.exit(1);
  }
}

main();
