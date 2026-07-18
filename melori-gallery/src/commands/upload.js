const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const ora = require('ora');
const { processImages, isAccepted } = require('../lib/image');
const { uploadToGallery } = require('../lib/api');
const { getConfig } = require('../lib/auth');

async function uploadCommand(filePath, options) {
  const spinner = ora('Initializing upload...').start();

  try {
    const config = await getConfig();
    if (!config.apiKey) {
      spinner.fail('No API key configured. Run: melori-gallery config --api-key YOUR_KEY');
      return;
    }

    const resolvedPath = path.resolve(filePath);
    const stat = await fs.stat(resolvedPath);

    let files = [];
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolvedPath);
      files = entries
        .filter((f) => isAccepted(f))
        .map((f) => path.join(resolvedPath, f));
    } else {
      files = [resolvedPath];
    }

    if (files.length === 0) {
      spinner.fail('No supported images found (jpg, jpeg, png, webp, tif, tiff).');
      return;
    }

    spinner.text = `Found ${files.length} image(s). Processing...`;

    const processedImages = await processImages(files, {
      maxWidth: parseInt(options.maxWidth, 10),
      quality: parseInt(options.quality, 10),
      clientName: options.client,
      galleryName: options.gallery,
    });

    if (processedImages.length === 0) {
      spinner.fail('No images could be processed.');
      return;
    }

    spinner.text = 'Uploading to Melori Gallery...';

    const result = await uploadToGallery({
      images: processedImages,
      clientName: options.client,
      galleryName: options.gallery,
      folderName: options.folder,
      clientEmail: options.email,
      forSale: Boolean(options.forSale),
      priceCents: options.price ? parseInt(options.price, 10) : null,
      apiKey: config.apiKey,
      apiUrl: config.apiUrl,
    });

    process.stdout.write('\n');
    spinner.succeed(chalk.green('✓ Upload complete!'));
    console.log(chalk.blue(`Gallery URL: ${result.galleryUrl}`));
    console.log(chalk.gray(`Client: ${options.client || 'Unnamed'}`));
    console.log(chalk.gray(`Images: ${result.imageCount}`));
    if (result.galleryUrl) {
      console.log(chalk.yellow('\nShare this link with your client!'));
    }
  } catch (error) {
    const detail = error.response?.data?.error || error.message;
    spinner.fail(`Upload failed: ${detail}`);
    process.exit(1);
  }
}

module.exports = uploadCommand;
