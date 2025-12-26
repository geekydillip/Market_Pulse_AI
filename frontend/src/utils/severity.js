export const SEVERITY_ORDER = ["High", "Medium", "Low"];

export function normalizeSeverity(val) {
  return val?.trim()?.toLowerCase()
    ?.replace(/^./, c => c.toUpperCase());
}
