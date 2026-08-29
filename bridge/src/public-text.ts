export function sanitizePublicText(value: string): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized
    .replace(
      /\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|authorization|password|secret)\b(\s*[:=]\s*)(?:Bearer\s+\S+|"[^"]*"|'[^']*'|\S+)/giu,
      "$1$2[redacted]",
    )
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, "$1[redacted]");
}
