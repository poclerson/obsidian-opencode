/** Mirrors OpenCode's encodeFilePath so the server receives the exact URI format its own clients use. */
export function encodeFilePath(filepath: string): string {
  const normalized = filepath.replace(/\\/g, "/");
  const rooted = /^[A-Za-z]:/.test(normalized) ? "/" + normalized : normalized;
  return rooted
    .split("/")
    .map((segment, index) => {
      if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join("/");
}

export function joinServerPath(directory: string, relativePath: string): string {
  if (!directory) return relativePath;
  const left = directory.replace(/[\\/]+$/, "");
  const right = relativePath.replace(/^[\\/]+/, "");
  return `${left}/${right}`;
}

export function fileUri(directory: string, relativePath: string): string {
  return `file://${encodeFilePath(joinServerPath(directory, relativePath))}`;
}

export function baseName(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index === -1 ? clean : clean.slice(index + 1);
}

export function parentPath(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index <= 0 ? "" : clean.slice(0, index);
}
