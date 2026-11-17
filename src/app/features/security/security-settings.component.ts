import { DOCUMENT } from '@angular/common';
import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideDownload, LucideKeyRound, LucideLock, LucideShieldCheck, LucideUpload } from '@lucide/angular';
import { ApplicationLockService } from '../../core/services/application-lock.service';
import { EncryptedBackupService, type PreparedBackupRestore } from '../../core/services/encrypted-backup.service';
import { ThemeService } from '../../core/services/theme.service';

@Component({
  selector: 'app-security-settings',
  imports: [DecimalPipe, FormsModule, LucideDownload, LucideKeyRound, LucideLock, LucideShieldCheck, LucideUpload],
  templateUrl: './security-settings.component.html',
  styleUrl: './security.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecuritySettingsComponent {
  private readonly document = inject(DOCUMENT);
  readonly lockService = inject(ApplicationLockService);
  private readonly themeService = inject(ThemeService);
  private readonly backupService = inject(EncryptedBackupService);

  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly selectedFile = signal<File | null>(null);

  enablePassphrase = '';
  confirmEnablePassphrase = '';
  currentPassphrase = '';
  replacementPassphrase = '';
  confirmReplacementPassphrase = '';
  disablePassphrase = '';
  exportPassphrase = '';
  confirmExportPassphrase = '';
  restorePassphrase = '';

  async enableLock(): Promise<void> {
    if (!this.matches(this.enablePassphrase, this.confirmEnablePassphrase, 'Passphrases do not match.')) return;
    await this.runAction(async () => {
      await this.lockService.enable(this.enablePassphrase);
      this.enablePassphrase = '';
      this.confirmEnablePassphrase = '';
      this.message.set('Application lock enabled. MyMoney will ask for the passphrase the next time it opens.');
    });
  }

  async changeLockPassphrase(): Promise<void> {
    if (!this.matches(this.replacementPassphrase, this.confirmReplacementPassphrase, 'New passphrases do not match.')) return;
    await this.runAction(async () => {
      await this.lockService.changePassphrase(this.currentPassphrase, this.replacementPassphrase);
      this.currentPassphrase = '';
      this.replacementPassphrase = '';
      this.confirmReplacementPassphrase = '';
      this.message.set('Application-lock passphrase changed.');
    });
  }

  async disableLock(): Promise<void> {
    await this.runAction(async () => {
      await this.lockService.disable(this.disablePassphrase);
      this.disablePassphrase = '';
      this.message.set('Application lock disabled.');
    });
  }

  async exportBackup(): Promise<void> {
    if (!this.matches(this.exportPassphrase, this.confirmExportPassphrase, 'Backup passphrases do not match.')) return;
    await this.runAction(async () => {
      const encrypted = await this.backupService.exportEncryptedBackup(this.exportPassphrase, this.themeService.theme());
      const view = this.document.defaultView;
      if (!view) throw new Error('File downloads are unavailable in this browser.');

      const blob = new Blob([encrypted], { type: 'application/vnd.mymoney.backup+json' });
      const objectUrl = view.URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = objectUrl;
      link.download = `mymoney-backup-${new Date().toISOString().slice(0, 10)}.mmbak`;
      link.style.display = 'none';
      this.document.body.append(link);
      link.click();
      link.remove();
      view.setTimeout(() => view.URL.revokeObjectURL(objectUrl), 0);
      this.exportPassphrase = '';
      this.confirmExportPassphrase = '';
      this.message.set('Encrypted backup download requested. Save the file somewhere private; the browser cannot confirm where it was saved.');
    });
  }

  onBackupFileSelected(event: Event): void {
    const input = event.target;
    const file = input instanceof HTMLInputElement ? input.files?.[0] ?? null : null;
    this.selectedFile.set(file);
    this.restorePassphrase = '';
    this.error.set('');
    this.message.set('');
    if (file && !file.name.toLowerCase().endsWith('.mmbak')) {
      this.selectedFile.set(null);
      if (input instanceof HTMLInputElement) input.value = '';
      this.error.set('Select a MyMoney encrypted backup file with the .mmbak extension.');
    }
  }

  async restoreBackup(): Promise<void> {
    const file = this.selectedFile();
    if (!file) {
      this.error.set('Choose an encrypted MyMoney backup file first.');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      this.error.set('The selected backup exceeds the supported 100 MB file size.');
      return;
    }
    await this.runAction(async () => {
      const serialized = await file.text();
      const prepared = await this.backupService.prepareRestore(serialized, this.restorePassphrase);
      if (!this.confirmReplacement(prepared)) {
        this.message.set('Restore cancelled. Existing data was not changed.');
        return;
      }
      await this.backupService.restorePreparedBackup(prepared);
      this.themeService.setTheme(prepared.theme);
      this.restorePassphrase = '';
      this.selectedFile.set(null);
      this.message.set('Backup restored successfully. MyMoney has replaced the local financial data.');
    });
  }

  lockNow(): void {
    this.lockService.lock();
  }

  private matches(left: string, right: string, message: string): boolean {
    if (left === right) return true;
    this.error.set(message);
    this.message.set('');
    return false;
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      await action();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'The requested operation could not be completed.');
    } finally {
      this.busy.set(false);
    }
  }

  private confirmReplacement(prepared: PreparedBackupRestore): boolean {
    const view = this.document.defaultView;
    if (!view) throw new Error('Restore confirmation is unavailable in this browser.');
    const total = Object.values(prepared.recordCounts).reduce((sum, count) => sum + count, 0);
    return view.confirm(
      `This will replace all current MyMoney accounts, transactions, ledger records, loans, budgets, savings data and settings with ${total} validated records from the backup dated ${prepared.createdAt.slice(0, 10)}. Your device-local application lock will remain unchanged. This cannot be undone. Continue?`,
    );
  }
}
