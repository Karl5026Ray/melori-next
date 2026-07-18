const chalk = require('chalk');
const { setConfig, promptForApiKey, getConfig, CONFIG_FILE } = require('../lib/auth');

async function configCommand(options) {
  // Non-interactive path: flags provided.
  if (options.apiKey || (options.apiUrl && process.argv.includes('--api-url'))) {
    const updates = {};
    if (options.apiKey) updates.apiKey = options.apiKey;
    if (options.apiUrl) updates.apiUrl = options.apiUrl;
    await setConfig(updates);
    console.log(chalk.green(`✓ Configuration saved to ${CONFIG_FILE}`));
    return;
  }

  // Interactive path.
  const current = await getConfig();
  if (current.apiKey) {
    console.log(chalk.gray(`Current API URL: ${current.apiUrl}`));
    console.log(chalk.gray('An API key is already configured.'));
  }
  await promptForApiKey();
}

module.exports = configCommand;
