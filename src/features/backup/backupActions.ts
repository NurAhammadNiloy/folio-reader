import { BackupRepository } from '../../core/storage/backupRepository';
import { SettingsRepository } from '../../core/storage/settingsRepository';
import { getDb } from '../../core/storage/db';
import { download, safeFileName } from '../../components/ui';
import { useApp } from '../../app/appStore';
import { beginWrite } from '../../core/storage/writeTracker';

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function exportLibraryBackup() {
  const end = beginWrite();
  try {
    const { buildBackup } = await import('../../core/export/backupFormat');
    const input = await BackupRepository.collect({ kind: 'library' });
    const zip = await buildBackup(input);
    download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `Folio library ${stamp()}.folio-backup`);
    await SettingsRepository.set('lastBackupAt', Date.now()).catch(() => undefined);
    useApp.getState().patchSettings({ lastBackupAt: Date.now() });
  } finally {
    end();
  }
}

export async function exportBookPackage(bookId: string) {
  const end = beginWrite();
  try {
    const { buildBackup } = await import('../../core/export/backupFormat');
    const book = await getDb().books.get(bookId);
    const input = await BackupRepository.collect({ kind: 'book', bookId });
    const zip = await buildBackup(input);
    download(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${safeFileName(book?.title ?? 'Book')} ${stamp()}.folio-backup`);
  } finally {
    end();
  }
}
