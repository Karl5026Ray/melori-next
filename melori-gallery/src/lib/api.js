const axios = require('axios');
const FormData = require('form-data');
const { createReadStream } = require('fs');

// Uploads clean originals + watermarked previews/thumbnails to the App Router
// endpoint. The server hashes the API key (we send it raw) and stores the
// clean original privately while serving the watermarked preview publicly.
async function uploadToGallery({
  images,
  clientName,
  galleryName,
  folderName,
  clientEmail,
  forSale,
  priceCents,
  apiKey,
  apiUrl,
}) {
  const formData = new FormData();

  formData.append('clientName', clientName || '');
  formData.append(
    'galleryName',
    galleryName || `Shoot ${new Date().toISOString().split('T')[0]}`,
  );
  if (folderName) formData.append('folderName', folderName);
  if (clientEmail) formData.append('clientEmail', clientEmail);

  for (const img of images) {
    formData.append('originals', createReadStream(img.original), {
      filename: img.filename,
      contentType: 'image/jpeg',
    });
    formData.append('previews', createReadStream(img.preview), {
      filename: img.filename.replace(/\.jpg$/, '_preview.jpg'),
      contentType: 'image/jpeg',
    });
    formData.append('thumbnails', createReadStream(img.thumbnail), {
      filename: img.filename.replace(/\.jpg$/, '_thumb.jpg'),
      contentType: 'image/jpeg',
    });
    formData.append('blurHashes', img.blurHash || '');
    formData.append('filenames', img.filename);
    formData.append('forSale', forSale ? 'true' : 'false');
    formData.append('priceCents', forSale && priceCents ? String(priceCents) : '');
  }

  const response = await axios.post(`${apiUrl}/upload`, formData, {
    headers: {
      ...formData.getHeaders(),
      Authorization: `Bearer ${apiKey}`,
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    onUploadProgress: (progressEvent) => {
      if (!progressEvent.total) return;
      const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
      process.stdout.write(`\rUpload progress: ${pct}%`);
    },
  });

  return response.data;
}

async function getGalleries(apiKey, apiUrl) {
  const response = await axios.get(`${apiUrl}/list`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return response.data;
}

module.exports = { uploadToGallery, getGalleries };
