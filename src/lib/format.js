export function formatBytes(bytes = 0) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;

  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function compactPath(folderPath = '') {
  if (!folderPath) {
    return '';
  }

  const normalized = folderPath.replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);

  if (parts.length <= 3) {
    return folderPath;
  }

  return `.../${parts.slice(-3).join('/')}`;
}
