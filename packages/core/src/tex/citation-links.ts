export type CitationLinks = { enabled: boolean; color: string; format: "color" | "underline" | "plain" };

export const DEFAULT_CITATION_LINKS: CitationLinks = { enabled: false, color: "#2457A6", format: "color" };

export function isCitationLinks(value: unknown): value is CitationLinks {
  if (!value || typeof value !== "object") return false;
  const links = value as Partial<CitationLinks>;
  return typeof links.enabled === "boolean" && typeof links.color === "string" && /^#[0-9a-f]{6}$/iu.test(links.color) &&
    (links.format === "color" || links.format === "underline" || links.format === "plain");
}
