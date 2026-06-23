// Returns the final path segment of a file path, handling both POSIX (`/`) and
// Windows (`\`) separators -- the native open dialog yields native paths, so this
// has to cope with both regardless of the host OS.
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
