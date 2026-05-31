/** Response must not echo raw implementation text or secrets. */
export function responseExcludesSensitiveCodeContent(
  json: string,
  forbiddenMarkers: string[]
): boolean {
  if (/"summary"\s*:/.test(json)) return false;
  if (/"implementation"\s*:/.test(json)) return false;
  if (/"steps"\s*:/.test(json)) return false;
  if (/"content"\s*:/.test(json)) return false;
  if (/"task"\s*:/.test(json) && !json.includes("taskPreview")) return false;
  for (const marker of forbiddenMarkers) {
    if (json.includes(marker)) return false;
  }
  return true;
}
