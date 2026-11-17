import { Inject, Injectable, signal } from '@angular/core';
import { MY_MONEY_DATABASE } from '../database/database.token';
import type { MyMoneyDatabase } from '../database/mymoney.database';
import { APPLICATION_LOCK_SETTING_KEY } from '../security/security.constants';
import type { ApplicationLockConfiguration, BackupCryptoService } from './backup-crypto.service';

@Injectable({ providedIn: 'root' })
export class ApplicationLockService {
  private readonly initializedState = signal(false);
  private readonly configuredState = signal(false);
  private readonly lockedState = signal(false);
  private readonly initializationErrorState = signal('');
  private cryptoServiceInstance?: BackupCryptoService;

  readonly initialized = this.initializedState.asReadonly();
  readonly configured = this.configuredState.asReadonly();
  readonly locked = this.lockedState.asReadonly();
  readonly initializationError = this.initializationErrorState.asReadonly();

  constructor(@Inject(MY_MONEY_DATABASE) private readonly database: MyMoneyDatabase) {}

  async initialize(): Promise<void> {
    this.initializedState.set(false);
    this.initializationErrorState.set('');
    try {
      const setting = await this.database.settings.get(APPLICATION_LOCK_SETTING_KEY);
      if (!setting) {
        this.configuredState.set(false);
        this.lockedState.set(false);
      } else {
        const cryptoService = await this.getCryptoService();
        cryptoService.parseLockConfiguration(setting.value);
        this.configuredState.set(true);
        this.lockedState.set(true);
      }
    } catch (error) {
      this.initializationErrorState.set(errorMessage(error, 'Unable to load application-lock settings.'));
    } finally {
      this.initializedState.set(true);
    }
  }

  async enable(passphrase: string): Promise<void> {
    if (await this.database.settings.get(APPLICATION_LOCK_SETTING_KEY)) {
      throw new Error('The application lock is already enabled.');
    }
    const cryptoService = await this.getCryptoService();
    const configuration = await cryptoService.createLockConfiguration(passphrase);
    await this.storeConfiguration(configuration);
    this.configuredState.set(true);
    this.lockedState.set(false);
  }

  async unlock(passphrase: string): Promise<void> {
    const configuration = await this.getConfiguration();
    const cryptoService = await this.getCryptoService();
    if (!await cryptoService.verifyLockPassphrase(configuration, passphrase)) {
      throw new Error('Incorrect passphrase.');
    }
    this.lockedState.set(false);
  }

  lock(): void {
    if (this.configuredState()) this.lockedState.set(true);
  }

  async changePassphrase(currentPassphrase: string, newPassphrase: string): Promise<void> {
    const configuration = await this.getConfiguration();
    const cryptoService = await this.getCryptoService();
    if (!await cryptoService.verifyLockPassphrase(configuration, currentPassphrase)) {
      throw new Error('Current passphrase is incorrect.');
    }
    const nextConfiguration = await cryptoService.createLockConfiguration(newPassphrase);
    await this.storeConfiguration(nextConfiguration);
  }

  async disable(passphrase: string): Promise<void> {
    const configuration = await this.getConfiguration();
    const cryptoService = await this.getCryptoService();
    if (!await cryptoService.verifyLockPassphrase(configuration, passphrase)) {
      throw new Error('Incorrect passphrase.');
    }
    await this.database.settings.delete(APPLICATION_LOCK_SETTING_KEY);
    this.configuredState.set(false);
    this.lockedState.set(false);
  }

  private async getConfiguration(): Promise<ApplicationLockConfiguration> {
    const setting = await this.database.settings.get(APPLICATION_LOCK_SETTING_KEY);
    if (!setting) throw new Error('Application lock is not enabled.');
    return (await this.getCryptoService()).parseLockConfiguration(setting.value);
  }

  private async storeConfiguration(configuration: ApplicationLockConfiguration): Promise<void> {
    await this.database.settings.put({
      key: APPLICATION_LOCK_SETTING_KEY,
      value: JSON.stringify(configuration),
      updatedAt: new Date().toISOString(),
    });
  }

  private async getCryptoService(): Promise<BackupCryptoService> {
    if (!this.cryptoServiceInstance) {
      const { BackupCryptoService: CryptoService } = await import('./backup-crypto.service');
      this.cryptoServiceInstance = new CryptoService();
    }
    return this.cryptoServiceInstance;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
