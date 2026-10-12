import { env } from '../env.js';
import { requestJson } from '../lib/http.js';
import { ConfigError } from '../lib/errors.js';

/**
 * Unsigned Cloudinary uploads, matching the n8n workflow which POSTed the
 * Drive bytes to `/image/upload` with `upload_preset: n8n_upload`.
 */

export interface CloudinaryUpload {
  secureUrl: string;
  publicId: string;
}

/** The enhancement chain the n8n "Edit Image" code node injected. */
export const ENHANCEMENT_TRANSFORMS = 'e_auto_color,e_auto_contrast,e_sharpen:50,e_improve';

export async function uploadImage(
  bytes: Buffer,
  fileName: string,
  contentType: string,
): Promise<CloudinaryUpload> {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } = env();
  if (!CLOUDINARY_CLOUD_NAME) {
    throw new ConfigError('CLOUDINARY_CLOUD_NAME is not set');
  }

  const form = new FormData();
  form.set('file', new Blob([bytes], { type: contentType }), fileName);
  form.set('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await requestJson<{ secure_url?: string; public_id?: string }>(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUDINARY_CLOUD_NAME)}/image/upload`,
    { method: 'POST', body: form },
  );

  if (!res?.secure_url) {
    throw new Error('Cloudinary upload returned no secure_url');
  }

  return { secureUrl: res.secure_url, publicId: res.public_id ?? '' };
}

/**
 * Injects the enhancement transforms into a delivery URL, skipping URLs that
 * already carry them. Non-Cloudinary URLs pass through untouched.
 */
export function enhanceUrl(url: string): string {
  if (!url.includes('/upload/')) return url;
  if (url.includes('e_auto_color')) return url;
  return url.replace('/upload/', `/upload/${ENHANCEMENT_TRANSFORMS}/`);
}
