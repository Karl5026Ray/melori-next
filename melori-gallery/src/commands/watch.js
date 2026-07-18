const chokidar = require('chokidar');
const chalk = require('chalk');
const path = require('path');
const uploadCommand = require('./upload');

async function watchCommand(folderPath, options) {
  console.log(chalk.blue(`Watching ${folderPath} for new images...`));
  console.log(chalk.gray('Press Ctrl+C to stop\n'));

  // Accepted formats only (RAW dropped — sharp can't decode it reliably).
  const watcher = chokidar.watch(
    path.join(folderPath, '*.{jpg,jpeg,png,webp,tif,tiff}'),
    {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100,
      },
    },
  );

  watcher.on('add', async (filePath) => {
    console.log(chalk.yellow(`New file detected: ${path.basename(filePath)}`));
    try {
      await uploadCommand(filePath, {
        ...options,
        client: options.client || 'Auto Upload',
      });
    } catch (error) {
      console.error(chalk.red(`Failed to upload ${filePath}: ${error.message}`));
    }
  });

  watcher.on('error', (error) => {
    console.error(chalk.red(`Watcher error: ${error}`));
  });

  process.stdin.resume();
}

module.exports = watchCommand;
