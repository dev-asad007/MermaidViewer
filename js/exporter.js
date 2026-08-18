import { safeBaseName } from "./project-store.js";

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dimensionsOf(svg) {
  const viewBox = svg.getAttribute("viewBox")?.trim().split(/[ ,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
    return { width: Math.max(1, viewBox[2]), height: Math.max(1, viewBox[3]), viewBox };
  }
  const rect = svg.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height), viewBox: [0, 0, rect.width, rect.height] };
}

function prepareSvg(svg, background = "transparent") {
  const clone = svg.cloneNode(true);
  const { width, height, viewBox } = dimensionsOf(svg);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", viewBox.join(" "));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.style.maxWidth = "none";
  clone.style.maxHeight = "none";
  clone.style.background = "transparent";

  if (background !== "transparent") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", String(viewBox[0]));
    rect.setAttribute("y", String(viewBox[1]));
    rect.setAttribute("width", String(viewBox[2]));
    rect.setAttribute("height", String(viewBox[3]));
    rect.setAttribute("fill", background);
    clone.insertBefore(rect, clone.firstChild);
  }

  return { clone, width, height };
}

function svgBlob(svg, background) {
  const prepared = prepareSvg(svg, background);
  const xml = new XMLSerializer().serializeToString(prepared.clone);
  return { ...prepared, blob: new Blob([xml], { type: "image/svg+xml;charset=utf-8" }), xml };
}

async function svgToCanvas(svg, scale, background) {
  await document.fonts?.ready;
  const { blob, width, height } = svgBlob(svg, background);
  const maxSide = 16000;
  const safeScale = Math.min(scale, maxSide / width, maxSide / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * safeScale));
  canvas.height = Math.max(1, Math.round(height * safeScale));
  const context = canvas.getContext("2d", { alpha: background === "transparent" });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("The diagram could not be converted to an image."));
      image.src = url;
    });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  return canvas;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Image encoding failed."))), type, quality);
  });
}

export function copySvgInto(sourceContainer, targetContainer) {
  const svg = sourceContainer.querySelector("svg");
  targetContainer.replaceChildren(svg ? svg.cloneNode(true) : document.createTextNode("Preview unavailable"));
}

export async function exportDiagram({ container, format, scale = 2, background = "transparent", filename, source }) {
  const svg = container.querySelector("svg");
  const base = safeBaseName(filename);

  if (format === "mmd") {
    downloadBlob(new Blob([source], { type: "text/plain;charset=utf-8" }), `${base}.mmd`);
    return;
  }
  if (format === "md") {
    const markdown = `# ${filename.replace(/\.[^.]+$/, "")}\n\n\`\`\`mermaid\n${source.trim()}\n\`\`\`\n`;
    downloadBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${base}.md`);
    return;
  }
  if (!svg) throw new Error("Render the diagram before exporting it.");

  if (format === "svg") {
    const { blob } = svgBlob(svg, background);
    downloadBlob(blob, `${base}.svg`);
    return;
  }

  if (format === "png" || format === "jpeg") {
    const rasterBackground = format === "jpeg" && background === "transparent" ? "#ffffff" : background;
    const canvas = await svgToCanvas(svg, scale, rasterBackground);
    const type = format === "png" ? "image/png" : "image/jpeg";
    const blob = await canvasBlob(canvas, type, 0.96);
    downloadBlob(blob, `${base}.${format === "jpeg" ? "jpg" : "png"}`);
    return;
  }

  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdfBackground = background === "transparent" ? "#ffffff" : background;
    const canvas = await svgToCanvas(svg, Math.max(3, scale), pdfBackground);
    const orientation = canvas.width >= canvas.height ? "landscape" : "portrait";
    const pdf = new jsPDF({ orientation, unit: "pt", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 34;
    const ratio = Math.min((pageWidth - margin * 2) / canvas.width, (pageHeight - margin * 2) / canvas.height);
    const width = canvas.width * ratio;
    const height = canvas.height * ratio;
    pdf.setProperties({ title: filename, subject: "Mermaid diagram", creator: "Mermaid Studio" });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, "FAST");
    pdf.save(`${base}.pdf`);
    return;
  }

  throw new Error(`Unsupported export format: ${format}`);
}
