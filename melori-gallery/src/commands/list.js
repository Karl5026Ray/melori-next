const chalk = require('chalk');
const ora = require('ora');
const { getGalleries } = require('../lib/api');
const { getConfig } = require('../lib/auth');

async function listCommand() {
  const spinner = ora('Fetching galleries...').start();
  try {
    const config = await getConfig();
    if (!config.apiKey) {
      spinner.fail('No API key configured. Run: melori-gallery config --api-key YOUR_KEY');
      return;
    }

    const data = await getGalleries(config.apiKey, config.apiUrl);
    const galleries = data.galleries || [];
    spinner.stop();

    if (galleries.length === 0) {
      console.log(chalk.gray('No galleries yet.'));
      return;
    }

    for (const g of galleries) {
      console.log(
        `${chalk.bold(g.name)} ${chalk.gray(`(${g.imageCount} photos)`)}\n  ${chalk.blue(`/gallery/${g.slug}`)}`,
      );
    }
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    spinner.fail(`Failed to list galleries: ${detail}`);
    process.exit(1);
  }
}

module.exports = listCommand;
