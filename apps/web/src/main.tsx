import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const { TikzBench } = await import("./TikzBench");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <TikzBench />
    </StrictMode>
  );
}

void bootstrap();
