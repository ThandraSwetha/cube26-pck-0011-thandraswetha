const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const MIN_IMAGE_EDGE = 768;
const WEBP_QUALITIES = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5];

function loadImageBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image could not be decoded."));
    };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("The browser could not compress this image."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function encodeImage(canvas, quality) {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp.type === "image/webp") return webp;
  const jpeg = await canvasToBlob(canvas, "image/jpeg", quality);
  if (jpeg.type !== "image/jpeg") {
    throw new Error("This browser does not support the required image compression.");
  }
  return jpeg;
}

async function compressImageForUpload(file) {
  let bitmap;
  try {
    bitmap = await loadImageBitmap(file);
    if (!bitmap.width || !bitmap.height) {
      throw new Error("The selected image has invalid dimensions.");
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("The browser could not prepare this image for upload.");
    }

    let maxEdge = Math.min(Math.max(bitmap.width, bitmap.height), MAX_IMAGE_EDGE);
    while (true) {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of WEBP_QUALITIES) {
        const blob = await encodeImage(canvas, quality);
        if (blob.size <= MAX_UPLOAD_BYTES) {
          const basename = file.name.replace(/\.[^.]+$/, "") || "pack-image";
          const extension = blob.type === "image/webp" ? ".webp" : ".jpg";
          return { blob, filename: `${basename}${extension}` };
        }
      }

      if (maxEdge <= MIN_IMAGE_EDGE) break;
      maxEdge = Math.max(MIN_IMAGE_EDGE, Math.floor(maxEdge * 0.8));
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("The selected image")) throw error;
    throw new Error("Could not compress this image for upload. Choose another JPG, PNG, or WEBP image and try again.");
  } finally {
    bitmap?.close?.();
  }

  throw new Error("Could not compress this image below the upload limit. Choose another image and try again.");
}

export { MAX_UPLOAD_BYTES, compressImageForUpload };
