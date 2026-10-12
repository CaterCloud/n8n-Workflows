import { google, type drive_v3 } from 'googleapis';
import { googleAuth } from './google-auth.js';
import { logger } from '../logger.js';

export interface DriveImage {
  id: string;
  name: string;
  mimeType: string;
  /** Direct-download link, matching the `uc?id=` form the n8n code built. */
  url: string;
}

let api: drive_v3.Drive | undefined;

function drive(): drive_v3.Drive {
  api ??= google.drive({ version: 'v3', auth: googleAuth() });
  return api;
}

function quote(id: string): string {
  return `'${id.replace(/'/g, "\\'")}'`;
}

/**
 * Every non-trashed image across the given folders.
 *
 * The n8n node issued a single hand-written query with the folder IDs inlined
 * and `returnAll: true`. Shared drives need `supportsAllDrives`, which the n8n
 * node did not set — add it here so folders on a Shared Drive resolve too.
 */
export async function listImagesInFolders(folderIds: readonly string[]): Promise<DriveImage[]> {
  if (folderIds.length === 0) return [];

  const parents = folderIds.map((id) => `${quote(id)} in parents`).join(' or ');
  const q = `(${parents}) and mimeType contains 'image/' and trashed = false`;

  const files: DriveImage[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive().files.list({
      q,
      fields: 'nextPageToken, files(id, name, mimeType)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name) continue;
      files.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType ?? 'image/jpeg',
        url: `https://drive.google.com/uc?id=${file.id}`,
      });
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  logger.debug('drive listed images', { folderCount: folderIds.length, imageCount: files.length });
  return files;
}

/** Raw bytes of a binary Drive file. */
export async function downloadFile(fileId: string): Promise<Buffer> {
  const res = await drive().files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' },
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/**
 * A Google Doc exported as plain text — the brand brief. n8n did this with
 * `googleFileConversion: { docsToFormat: 'text/plain' }` followed by an
 * "Extract from File" node; `files.export` does both in one call.
 */
export async function exportDocAsText(fileId: string): Promise<string> {
  const res = await drive().files.export(
    { fileId, mimeType: 'text/plain' },
    { responseType: 'text' },
  );
  return typeof res.data === 'string' ? res.data : String(res.data ?? '');
}

/** Test hook. */
export function setDriveForTesting(value: drive_v3.Drive | undefined): void {
  api = value;
}
