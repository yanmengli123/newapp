export type ExportSizePreset = "1200x800" | "1600x1000" | "2000x1200" | "2400x1600";

export const EXPORT_SIZE_OPTIONS: { value: ExportSizePreset; label: string }[] = [
  { value: "1200x800", label: "1200×800" },
  { value: "1600x1000", label: "1600×1000" },
  { value: "2000x1200", label: "2000×1200" },
  { value: "2400x1600", label: "2400×1600" },
];

export function parsePresetSize(preset: ExportSizePreset): { width: number; height: number } {
  const [width, height] = preset.split("x").map(Number);
  return { width, height };
}

/**
 * Finds all ECharts-rendered <canvas> elements inside a container,
 * composites them into a single PNG at the target size, and triggers download.
 */
export function exportGOEnrichmentChart(
  container: HTMLElement,
  targetWidth: number,
  targetHeight: number,
  background: "white" | "transparent",
  filename: string,
): void {
  const canvases = Array.from(container.querySelectorAll("canvas"));
  if (canvases.length === 0) return;

  const containerRect = container.getBoundingClientRect();

  const composite = document.createElement("canvas");
  composite.width = targetWidth;
  composite.height = targetHeight;
  const ctx = composite.getContext("2d");
  if (!ctx) return;

  if (background === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  const containerW = container.scrollWidth;
  const containerH = container.scrollHeight;
  if (containerW === 0 || containerH === 0) return;

  const scale = Math.min(targetWidth / containerW, targetHeight / containerH);
  const offsetX = (targetWidth - containerW * scale) / 2;
  const offsetY = (targetHeight - containerH * scale) / 2;

  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    const x = offsetX + (rect.left - containerRect.left) * scale;
    const y = offsetY + (rect.top - containerRect.top) * scale;
    const w = rect.width * scale;
    const h = rect.height * scale;
    if (w > 0 && h > 0) {
      ctx.drawImage(canvas, x, y, w, h);
    }
  }

  const dataUrl = composite.toDataURL("image/png");
  triggerDownload(dataUrl, filename);
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
