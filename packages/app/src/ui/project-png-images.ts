import { createContext } from "react";

export const ProjectIdContext = createContext<string | null>(null);
export const ProjectCompilationContext = createContext<(source: string) => string>((source) => source);
const loadedImages = new Set<string>();

function assetUrl(projectId: string, image: Element): string | null {
  const key = image.getAttribute("data-project-png");
  if (!key || !/^[0-9a-f]{64}\.(?:png|pdf)$/u.test(key)) return null;
  return `/api/projects/${encodeURIComponent(projectId)}/${key.endsWith(".png") ? "png" : "assets"}/${key}`;
}

export function connectProjectPngImages(root: ParentNode, projectId: string): void {
  for (const image of Array.from(root.querySelectorAll("image[data-project-png]:not([href])"))) {
    const url = assetUrl(projectId, image);
    if (!url) continue;
    const hidePlaceholder = () => {
      image.previousElementSibling?.setAttribute("display", "none");
    };
    if (loadedImages.has(url)) hidePlaceholder();
    image.addEventListener("load", () => {
      loadedImages.add(url);
      hidePlaceholder();
    }, { once: true });
    image.addEventListener("error", () => {
      loadedImages.delete(url);
      image.previousElementSibling?.removeAttribute("display");
    }, { once: true });
    image.setAttribute("href", url);
  }
}

/** Comparison markup is serialized again, so include the same bytes in that copy. */
export async function embedProjectPngImages(markup: string, projectId: string | null): Promise<string> {
  if (!projectId || !markup.includes("data-project-png=")) return markup;
  const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  const bytesByUrl = new Map<string, Promise<string>>();
  await Promise.all(Array.from(root.querySelectorAll("image[data-project-png]"), async (image) => {
    const url = assetUrl(projectId, image);
    if (!url) return;
    let data = bytesByUrl.get(url);
    if (!data) {
      data = fetch(url).then(async (response) => {
        if (!response.ok) throw new Error(`缺少 PNG：${image.getAttribute("data-project-png") ?? ""}`);
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("无法读取 PNG。"));
          };
          reader.onerror = () => { reject(reader.error ?? new Error("无法读取 PNG。")); };
          reader.readAsDataURL(blob);
        });
      });
      bytesByUrl.set(url, data);
    }
    image.setAttribute("href", await data);
    image.previousElementSibling?.remove();
  }));
  return new XMLSerializer().serializeToString(root);
}
