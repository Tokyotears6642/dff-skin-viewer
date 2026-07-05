function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      resolve(null);
      return;
    }

    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    image.src = dataUrl;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export async function composeLogoTexture({
  baseDataUrl,
  logoDataUrl,
  materialColor = '#ffffff',
  opacity = 0.85,
  size = 0.28,
  x = 0.5,
  y = 0.5,
  rotation = 0
}) {
  const [baseImage, logoImage] = await Promise.all([loadImage(baseDataUrl), loadImage(logoDataUrl)]);
  const width = clamp(baseImage?.naturalWidth || baseImage?.width || 512, 64, 2048);
  const height = clamp(baseImage?.naturalHeight || baseImage?.height || 512, 64, 2048);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = width;
  canvas.height = height;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  if (baseImage) {
    context.drawImage(baseImage, 0, 0, width, height);
  } else {
    context.fillStyle = materialColor || '#ffffff';
    context.fillRect(0, 0, width, height);
  }

  if (logoImage) {
    const logoWidth = clamp(size, 0.02, 1.5) * width;
    const aspect = (logoImage.naturalWidth || logoImage.width || 1) / Math.max(logoImage.naturalHeight || logoImage.height || 1, 1);
    const logoHeight = logoWidth / Math.max(aspect, 0.01);
    const centerX = clamp(x, 0, 1) * width;
    const centerY = clamp(y, 0, 1) * height;

    context.save();
    context.globalAlpha = clamp(opacity, 0, 1);
    context.translate(centerX, centerY);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(logoImage, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight);
    context.restore();
  }

  return canvas.toDataURL('image/png');
}
