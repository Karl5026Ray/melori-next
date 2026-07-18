#!/usr/bin/env node
const { program } = require('commander');
const uploadCommand = require('./commands/upload');
const watchCommand = require('./commands/watch');
const configCommand = require('./commands/config');

// Default API base points at the App Router gallery endpoints
// (/api/gallery/upload, /api/gallery/list).
const DEFAULT_API_URL = 'https://melorimusic.org/api/gallery';

program
  .name('melori-gallery')
  .description('CLI tool for Melori Gallery uploads')
  .version('1.0.0');

program
  .command('upload <path>')
  .description('Upload photos to a gallery')
  .option('-c, --client <name>', 'Client name')
  .option('-g, --gallery <name>', 'Gallery name')
  .option('-f, --folder <name>', 'Folder (sub-group) inside the gallery')
  .option('-e, --email <email>', 'Client email (sends a gallery-ready notification)')
  .option('--for-sale', 'Mark uploaded photos as for sale (digital download)')
  .option('--price <cents>', 'Digital download price in cents (with --for-sale)')
  .option('--quality <number>', 'JPEG quality (1-100)', '90')
  .option('--max-width <pixels>', 'Max preview width', '2400')
  .action(uploadCommand);

program
  .command('watch <path>')
  .description('Watch a folder and auto-upload new photos')
  .option('-c, --client <name>', 'Client name')
  .option('-g, --gallery <name>', 'Gallery name')
  .option('-f, --folder <name>', 'Folder (sub-group) inside the gallery')
  .option('-e, --email <email>', 'Client email (sends a gallery-ready notification)')
  .option('--quality <number>', 'JPEG quality (1-100)', '90')
  .option('--max-width <pixels>', 'Max preview width', '2400')
  .action(watchCommand);

program
  .command('config')
  .description('Configure API settings')
  .option('--api-key <key>', 'Set API key')
  .option('--api-url <url>', 'Set API URL', DEFAULT_API_URL)
  .action(configCommand);

program
  .command('list')
  .description('List your galleries')
  .action(require('./commands/list'));

program.parse();

module.exports = { DEFAULT_API_URL };
