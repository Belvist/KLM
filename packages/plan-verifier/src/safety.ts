/** Response must not echo raw plan steps or secrets. */
export function responseExcludesSensitivePlanContent(
  json: string,
  forbiddenMarkers: string[]
): boolean {
  const lower = json.toLowerCase();
  if (lower.includes('"content"') || lower.includes('"contenthash"')) return false;
  if (/"task"\s*:/.test(json)) return false;
  if (/"steps"\s*:/.test(json)) return false;
  for (const marker of forbiddenMarkers) {
    if (json.includes(marker)) return false;
  }
  return true;
}
