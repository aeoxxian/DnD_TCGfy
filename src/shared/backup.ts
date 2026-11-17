import { z } from 'zod';
import type { Library, Result } from './contracts';

export const BACKUP_FORMAT = 'dnd-tcg-fy-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const backupCountsSchema = z.strictObject({
  cards: z.number().int().nonnegative(), trashedCards: z.number().int().nonnegative(),
  characters: z.number().int().nonnegative(), decks: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(), assets: z.number().int().nonnegative(), tags: z.number().int().nonnegative(),
});
export type BackupCounts = z.infer<typeof backupCountsSchema>;

export const backupManifestSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  appVersion: z.string().min(1).max(40),
  schemaVersion: z.number().int().min(1).max(1000),
  createdAt: z.iso.datetime(),
  counts: backupCountsSchema,
  files: z.array(z.strictObject({
    path: z.string().min(1).max(200),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })).min(1).max(20001),
});
export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface BackupExportResult { canceled: false; path: string; bytes: number; files: number; counts: BackupCounts; warnings: string[] }
export interface RestorePreview {
  canceled: false; token: string; fileName: string;
  backup: { appVersion: string; schemaVersion: number; createdAt: string; counts: BackupCounts; totalBytes: number; files: number };
  current: BackupCounts;
  /** Cards in the backup that also exist in the current library (same IDs): it is a backup of this library. */
  sharedCardIds: number;
  /** Active backup cards whose name already exists in the current library (copy mode would add a second one). */
  duplicateNames: number;
  checks: string[]; warnings: string[];
}
export interface BackupStatus { dataPath: string; autoBackupFolder: string; lastAutoBackup?: string; autoBackups: number }
export type RestoreResult =
  | { mode: 'replace'; restarting: true; preservedIn: string }
  | { mode: 'copy'; added: number; images: number; tagsCreated: number; library: Library };

export const restoreTokenSchema = z.strictObject({ token: z.uuid() });
export const applyRestoreSchema = z.strictObject({ token: z.uuid(), mode: z.enum(['replace', 'copy']), confirmed: z.literal(true) });
export type ApplyRestoreInput = z.infer<typeof applyRestoreSchema>;

export interface BackupBridge {
  exportBackup(): Promise<Result<BackupExportResult | { canceled: true }>>;
  inspectBackup(): Promise<Result<RestorePreview | { canceled: true }>>;
  applyBackup(input: ApplyRestoreInput): Promise<Result<RestoreResult>>;
  discardBackup(input: { token: string }): Promise<Result<true>>;
  getBackupStatus(): Promise<Result<BackupStatus>>;
}
