const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');

const DEFAULT_API_URL = 'https://melorimusic.org/api/gallery';
const CONFIG_DIR = path.join(os.homedir(), '.melori');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

async function getConfig() {
  try {
    const exists = await fs.pathExists(CONFIG_FILE);
    if (!exists) {
      return { apiUrl: DEFAULT_API_URL };
    }
    const cfg = await fs.readJson(CONFIG_FILE);
    return { apiUrl: DEFAULT_API_URL, ...cfg };
  } catch {
    return { apiUrl: DEFAULT_API_URL };
  }
}

async function setConfig(updates) {
  await fs.ensureDir(CONFIG_DIR);
  const current = await getConfig();
  const config = { ...current, ...updates };
  await fs.writeJson(CONFIG_FILE, config, { spaces: 2 });
  // The file holds a raw API key — lock it down to the owner.
  await fs.chmod(CONFIG_FILE, 0o600);
  return config;
}

async function promptForApiKey() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'apiKey',
      message: 'Enter your Melori API key:',
      validate: (input) => input.length > 0 || 'API key is required',
    },
    {
      type: 'input',
      name: 'apiUrl',
      message: 'API URL:',
      default: DEFAULT_API_URL,
    },
  ]);

  await setConfig(answers);
  console.log(chalk.green('✓ Configuration saved!'));
  return answers;
}

module.exports = { getConfig, setConfig, promptForApiKey, CONFIG_FILE, DEFAULT_API_URL };
