const modelExtensions = new Set(['.dff']);
const textureExtensions = new Set(['.txd']);
const animationExtensions = new Set(['.ifp']);

function parentFolder(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex).toLowerCase() : '';
}

export function buildCatalog(files = []) {
  const dffFiles = files.filter((file) => modelExtensions.has(file.ext));
  const txdFiles = files.filter((file) => textureExtensions.has(file.ext));
  const ifpFiles = files.filter((file) => animationExtensions.has(file.ext));

  const txdByBase = new Map();
  for (const txd of txdFiles) {
    const key = txd.baseName.toLowerCase();
    const existing = txdByBase.get(key) ?? [];
    existing.push(txd);
    txdByBase.set(key, existing);
  }

  const models = dffFiles.map((dff) => {
    const key = dff.baseName.toLowerCase();
    const candidates = txdByBase.get(key) ?? [];
    const dffFolder = parentFolder(dff.relativePath);
    const txd = candidates.find((candidate) => parentFolder(candidate.relativePath) === dffFolder) ?? candidates[0] ?? null;

    return {
      id: dff.fullPath,
      displayName: dff.baseName,
      dff,
      txd,
      hasTexture: Boolean(txd)
    };
  });

  return {
    models,
    ifpFiles,
    dffCount: dffFiles.length,
    txdCount: txdFiles.length,
    ifpCount: ifpFiles.length,
    unpairedCount: models.filter((model) => !model.hasTexture).length
  };
}

export function filterModels(models, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return models;
  }

  return models.filter((model) => {
    return (
      model.displayName.toLowerCase().includes(normalizedQuery) ||
      model.dff.relativePath.toLowerCase().includes(normalizedQuery)
    );
  });
}
