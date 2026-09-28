import sharp from "sharp";

function scaled(value, ratio) {
  return Math.round(value * ratio);
}

export function bottomSeatCropRegion({ width, height } = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Image dimensions are required to crop the bottom seat.");
  }

  const isTallHistoryScreenshot = height > width * 1.2;
  return {
    left: scaled(width, 0.2),
    top: scaled(height, isTallHistoryScreenshot ? 0.2 : 0.45),
    width: scaled(width, 0.6),
    height: scaled(height, isTallHistoryScreenshot ? 0.25 : 0.5),
  };
}

export function boardCropRegion({ width, height } = {}) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("Image dimensions are required to crop the board.");
  }
  const isTallHistoryScreenshot = height > width * 1.2;
  return {
    left: scaled(width, isTallHistoryScreenshot ? 0.28 : 0.25),
    top: scaled(height, isTallHistoryScreenshot ? 0.17 : 0.3),
    width: scaled(width, isTallHistoryScreenshot ? 0.44 : 0.5),
    height: scaled(height, isTallHistoryScreenshot ? 0.13 : 0.25),
  };
}

async function cropImage({ imageBase64, mimeType }, regionFor) {
  const input = Buffer.from(String(imageBase64 || ""), "base64");
  if (!input.length) throw new Error("Screenshot image data is required.");

  const image = sharp(input);
  const metadata = await image.metadata();
  const region = regionFor({ width: metadata.width, height: metadata.height });
  let cropped = image.extract(region);
  const outputMimeType = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  cropped = outputMimeType === "image/jpeg" ? cropped.jpeg() : cropped.png();
  const buffer = await cropped.toBuffer();

  return {
    imageBase64: buffer.toString("base64"),
    mimeType: outputMimeType,
    region,
  };
}

export const cropBottomSeatImage = (args = {}) => cropImage(args, bottomSeatCropRegion);
export const cropBoardImage = (args = {}) => cropImage(args, boardCropRegion);
