import { TXDLoader } from 'dff-loader';

export function disposeTextureDictionary(textureDictionary) {
  if (!textureDictionary) {
    return;
  }

  for (const entry of textureDictionary.values()) {
    const texture = entry?.texture ?? entry;
    if (texture?.dispose) {
      texture.dispose();
    }
  }
}

export function normalizeTextureDictionary(textureDictionary) {
  if (!textureDictionary) {
    return textureDictionary;
  }

  for (const entry of textureDictionary.values()) {
    if (entry?.texture && !entry.clone) {
      entry.clone = () => entry.texture.clone();
    }
  }

  return textureDictionary;
}

function textureImageToDataUrl(image, maxDimension = Infinity) {
  if (!image?.data || !image.width || !image.height) {
    return '';
  }

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;

  const sourceContext = sourceCanvas.getContext('2d');
  const data = new Uint8ClampedArray(image.data);
  sourceContext.putImageData(new ImageData(data, image.width, image.height), 0, 0);

  const scale = Number.isFinite(maxDimension)
    ? Math.min(1, maxDimension / Math.max(image.width, image.height))
    : 1;

  if (scale >= 1) {
    return sourceCanvas.toDataURL('image/png');
  }

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = Math.max(1, Math.round(image.width * scale));
  previewCanvas.height = Math.max(1, Math.round(image.height * scale));
  const previewContext = previewCanvas.getContext('2d');
  previewContext.imageSmoothingEnabled = true;
  previewContext.imageSmoothingQuality = 'high';
  previewContext.drawImage(sourceCanvas, 0, 0, previewCanvas.width, previewCanvas.height);

  return previewCanvas.toDataURL('image/png');
}

export function createTexturePreviews(textureDictionary, options = {}) {
  if (!textureDictionary) {
    return [];
  }

  const previews = [];
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : Infinity;
  const maxDimension = Number.isFinite(options.maxDimension) ? options.maxDimension : Infinity;

  for (const [name, entry] of textureDictionary.entries()) {
    if (previews.length >= limit) {
      break;
    }

    const texture = entry?.texture ?? entry;
    const image = texture?.image;
    const dataUrl = textureImageToDataUrl(image, maxDimension);

    if (!dataUrl) {
      continue;
    }

    previews.push({
      id: name,
      name,
      width: image.width,
      height: image.height,
      hasAlpha: Boolean(entry?.hasAlpha),
      dataUrl
    });
  }

  return previews.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export function parseTxdTexturePreviews(arrayBuffer, options = {}) {
  const textureDictionary = normalizeTextureDictionary(new TXDLoader().parse(arrayBuffer));
  try {
    return createTexturePreviews(textureDictionary, options);
  } finally {
    disposeTextureDictionary(textureDictionary);
  }
}
