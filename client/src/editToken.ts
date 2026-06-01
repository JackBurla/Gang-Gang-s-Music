const PREFIX = "ggm:editToken:";

function key(name: string): string {
  return PREFIX + name.trim().toLowerCase();
}

export function getEditToken(name: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key(name));
  } catch {
    return null;
  }
}

export function saveEditToken(name: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(name), token);
  } catch {
    // localStorage may be unavailable (private mode, etc.); ignore.
  }
}
