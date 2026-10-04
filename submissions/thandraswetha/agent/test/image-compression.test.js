import test from "node:test";
import assert from "node:assert/strict";
import { MAX_UPLOAD_BYTES, compressImageForUpload } from "../web/src/image-compression.js";

test("compresses and resizes images to a WebP upload below 4 MiB", async () => {
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  const bitmap = { width: 4000, height: 3000, close() {} };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      drawImage() {},
      set fillStyle(_value) {},
    }),
    toBlob(callback, type, quality) {
      const size = quality <= 0.66 ? MAX_UPLOAD_BYTES - 1 : MAX_UPLOAD_BYTES + 100;
      callback(new Blob([new Uint8Array(size)], { type }));
    },
  };
  globalThis.createImageBitmap = async () => bitmap;
  globalThis.document = { createElement: () => canvas };

  try {
    const result = await compressImageForUpload({
      name: "package.png",
      type: "image/png",
    });
    assert.equal(result.blob.type, "image/webp");
    assert.ok(result.blob.size < 4 * 1024 * 1024);
    assert.equal(result.filename, "package.webp");
    assert.equal(canvas.width, 2560);
    assert.equal(canvas.height, 1920);
  } finally {
    globalThis.createImageBitmap = originalBitmap;
    globalThis.document = originalDocument;
  }
});

test("does not allow an image through when compression cannot meet the upload limit", async () => {
  const originalBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 900 });
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        drawImage() {},
        set fillStyle(_value) {},
      }),
      toBlob(callback, type) {
        callback(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type }));
      },
    }),
  };

  try {
    await assert.rejects(
      compressImageForUpload({ name: "large.webp", type: "image/webp" }),
      /Could not compress this image below the upload limit/,
    );
  } finally {
    globalThis.createImageBitmap = originalBitmap;
    globalThis.document = originalDocument;
  }
});
