"use strict";

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const formatSelect = document.querySelector("#format");
const avifOption = document.querySelector("#avifOption");
const qualityInput = document.querySelector("#quality");
const qualityValue = document.querySelector("#qualityValue");
const maxWidthInput = document.querySelector("#maxWidth");
const jpegBackground = document.querySelector("#jpegBackground");
const jpegBackgroundGroup = document.querySelector("#jpegBackgroundGroup");
const jpegBackgroundHint = document.querySelector("#jpegBackgroundHint");
const dontUpscale = document.querySelector("#dontUpscale");
const seoNames = document.querySelector("#seoNames");
const webPreset = document.querySelector("#webPreset");
const clearButton = document.querySelector("#clearButton");
const convertButton = document.querySelector("#convertButton");
const emptyState = document.querySelector("#emptyState");
const results = document.querySelector("#results");

let queue = [];
let generatedUrls = [];
let queueHasTransparency = false;

const extensionForMime = {
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = qualityInput.value;
});

formatSelect.addEventListener("change", updateJpegBackgroundVisibility);

webPreset.addEventListener("click", () => {
  formatSelect.value = "image/webp";
  qualityInput.value = "82";
  qualityValue.textContent = "82";
  maxWidthInput.value = "1920";
  dontUpscale.checked = true;
  seoNames.checked = true;
  jpegBackground.value = "#ffffff";
  updateJpegBackgroundVisibility();
});

fileInput.addEventListener("change", () => addFiles(fileInput.files));

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragover");
});

for (const eventName of ["dragleave", "dragend"]) {
  dropZone.addEventListener(eventName, () => dropZone.classList.remove("dragover"));
}

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
  addFiles(event.dataTransfer.files);
});

clearButton.addEventListener("click", clearAll);
convertButton.addEventListener("click", convertQueue);

async function addFiles(fileList) {
  const incoming = [...fileList].filter((file) => file.type.startsWith("image/"));
  if (!incoming.length) return;

  queue.push(...incoming);
  renderQueue();
  fileInput.value = "";
  convertButton.disabled = true;

  if (!queueHasTransparency) {
    for (const file of incoming) {
      if (await imageHasTransparency(file)) {
        queueHasTransparency = true;
        break;
      }
    }
  }

  updateJpegBackgroundVisibility();
  convertButton.disabled = queue.length === 0;
}

function renderQueue() {
  revokeGeneratedUrls();
  results.replaceChildren();
  emptyState.hidden = queue.length > 0;
  convertButton.disabled = queue.length === 0;

  for (const file of queue) {
    const card = document.createElement("div");
    card.className = "result-card";

    const preview = document.createElement("img");
    const previewUrl = URL.createObjectURL(file);
    generatedUrls.push(previewUrl);
    preview.src = previewUrl;
    preview.alt = "";

    const body = document.createElement("div");
    const name = document.createElement("div");
    name.className = "result-name";
    name.textContent = file.name;

    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = `${formatBytes(file.size)} · ready to convert`;

    body.append(name, meta);
    card.append(preview, body);
    results.append(card);
  }
}

async function convertQueue() {
  if (!queue.length) return;

  const outputMime = formatSelect.value;
  const quality = Number(qualityInput.value) / 100;
  const maxWidth = Math.max(1, Number(maxWidthInput.value) || 1920);

  convertButton.disabled = true;
  convertButton.textContent = "Converting…";
  revokeGeneratedUrls();
  results.replaceChildren();

  for (const file of queue) {
    const card = createWorkingCard(file);
    results.append(card.element);

    try {
      const converted = await convertFile(file, {
        outputMime,
        quality,
        maxWidth,
        dontUpscale: dontUpscale.checked,
        seoNames: seoNames.checked,
        jpegBackground: jpegBackground.value,
      });

      const outputUrl = URL.createObjectURL(converted.blob);
      generatedUrls.push(outputUrl);

      card.preview.src = outputUrl;
      card.name.textContent = converted.outputName;
      card.meta.innerHTML = buildResultMeta(file.size, converted.blob.size, converted.width, converted.height);

      const download = document.createElement("a");
      download.className = "download-button";
      download.href = outputUrl;
      download.download = converted.outputName;
      download.textContent = "Download";

      card.element.append(download);
    } catch (error) {
      card.meta.className = "result-meta result-error";
      card.meta.textContent = error instanceof Error ? error.message : "Conversion failed.";
    }
  }

  convertButton.disabled = false;
  convertButton.textContent = "Convert images";
}

function createWorkingCard(file) {
  const element = document.createElement("div");
  element.className = "result-card";

  const preview = document.createElement("img");
  const previewUrl = URL.createObjectURL(file);
  generatedUrls.push(previewUrl);
  preview.src = previewUrl;
  preview.alt = "";

  const body = document.createElement("div");
  const name = document.createElement("div");
  name.className = "result-name";
  name.textContent = file.name;

  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.textContent = "Converting locally in your browser…";

  body.append(name, meta);
  element.append(preview, body);

  return { element, preview, name, meta };
}

async function convertFile(file, options) {
  const decoded = await decodeImage(file);
  const sourceWidth = decoded.width;
  const sourceHeight = decoded.height;

  let targetWidth = sourceWidth;

  if (sourceWidth > options.maxWidth || (!options.dontUpscale && sourceWidth < options.maxWidth)) {
    targetWidth = options.maxWidth;
  }

  const scale = targetWidth / sourceWidth;
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const context = canvas.getContext("2d", { alpha: options.outputMime !== "image/jpeg" });
  if (!context) throw new Error("Your browser could not create an image canvas.");

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (options.outputMime === "image/jpeg") {
    context.fillStyle = options.jpegBackground;
    context.fillRect(0, 0, targetWidth, targetHeight);
  }

  context.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);
  decoded.close?.();

  const blob = await canvasToBlob(canvas, options.outputMime, options.quality);

  if (blob.type !== options.outputMime) {
    throw new Error(`${labelForMime(options.outputMime)} encoding is not supported by this browser.`);
  }

  const extension = extensionForMime[options.outputMime];
  const outputName = `${options.seoNames ? seoSlug(file.name) : fileStem(file.name)}${extension}`;

  return { blob, outputName, width: targetWidth, height: targetHeight };
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {}
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("The browser could not encode this image."));
      resolve(blob);
    }, mime, mime === "image/png" ? undefined : quality);
  });
}

function fileStem(filename) {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(0, dot) : filename;
}

function seoSlug(filename) {
  const base = fileStem(filename)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "image";
}

function buildResultMeta(before, after, width, height) {
  const delta = before ? ((before - after) / before) * 100 : 0;
  const comparison = delta >= 0
    ? `<span class="result-status">${delta.toFixed(1)}% smaller</span>`
    : `<span class="result-error">${Math.abs(delta).toFixed(1)}% larger</span>`;
  return `${width}×${height} · ${formatBytes(before)} → ${formatBytes(after)} · ${comparison}`;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function labelForMime(mime) {
  return { "image/webp": "WebP", "image/avif": "AVIF", "image/jpeg": "JPEG", "image/png": "PNG" }[mime] || mime;
}

function revokeGeneratedUrls() {
  for (const url of generatedUrls) URL.revokeObjectURL(url);
  generatedUrls = [];
}

function clearAll() {
  queue = [];
  queueHasTransparency = false;
  revokeGeneratedUrls();
  results.replaceChildren();
  emptyState.hidden = false;
  convertButton.disabled = true;
  fileInput.value = "";
  updateJpegBackgroundVisibility();
}

function updateJpegBackgroundVisibility() {
  const shouldShow = formatSelect.value === "image/jpeg" && queueHasTransparency;
  jpegBackgroundGroup.hidden = !shouldShow;
  if (shouldShow) jpegBackgroundHint.textContent = "Transparency detected. Choose the colour used to replace transparent pixels in the JPEG.";
}

async function imageHasTransparency(file) {
  if (file.type === "image/jpeg") return false;
  let decoded;
  try {
    decoded = await decodeImage(file);
    const probeLimit = 512;
    const scale = Math.min(1, probeLimit / decoded.width, probeLimit / decoded.height);
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!context) return false;
    context.clearRect(0, 0, width, height);
    context.drawImage(decoded.source, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 255) return true;
    return false;
  } catch {
    return false;
  } finally {
    decoded?.close?.();
  }
}

async function detectAvifEncoding() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  try {
    const blob = await canvasToBlob(canvas, "image/avif", 0.8);
    const supported = blob.type === "image/avif";
    avifOption.disabled = !supported;
    avifOption.textContent = supported ? "AVIF — smaller, if supported" : "AVIF — encoding unavailable in this browser";
  } catch {
    avifOption.disabled = true;
    avifOption.textContent = "AVIF — encoding unavailable in this browser";
  }
}

convertButton.disabled = true;
updateJpegBackgroundVisibility();
detectAvifEncoding();
