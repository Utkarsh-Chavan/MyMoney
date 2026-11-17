import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { MyMoneyDatabase } from '../database/mymoney.database';
import { ApplicationLockService } from './application-lock.service';
import { APPLICATION_LOCK_SETTING_KEY, BackupCryptoService } from './backup-crypto.service';

describe('ApplicationLockService', () => {
  let database: MyMoneyDatabase | undefined;

  afterEach(async () => {
    if (database) await database.delete();
  });

  it('enables, manually locks, unlocks, changes and disables the lock without storing passphrases', async () => {
    database = new MyMoneyDatabase(`mymoney-lock-${crypto.randomUUID()}`);
    const cryptoService = new BackupCryptoService();
    const lockService = new ApplicationLockService(database);
    await lockService.initialize();
    expect(lockService.configured()).toBe(false);
    expect(lockService.locked()).toBe(false);

    await lockService.enable('a-private-device-lock-phrase');
    expect(lockService.configured()).toBe(true);
    const stored = await database.settings.get(APPLICATION_LOCK_SETTING_KEY);
    expect(stored?.value).not.toContain('a-private-device-lock-phrase');
    expect(JSON.parse(stored!.value)).toMatchObject({ version: 1, iterations: 600_000 });

    lockService.lock();
    expect(lockService.locked()).toBe(true);
    await expect(lockService.unlock('a-wrong-device-lock-phrase')).rejects.toThrow('Incorrect passphrase');
    await lockService.unlock('a-private-device-lock-phrase');
    expect(lockService.locked()).toBe(false);

    await expect(lockService.changePassphrase('a-wrong-device-lock-phrase', 'a-new-device-lock-phrase'))
      .rejects.toThrow('Current passphrase is incorrect');
    await lockService.changePassphrase('a-private-device-lock-phrase', 'a-new-device-lock-phrase');
    const configuration = cryptoService.parseLockConfiguration(
      (await database.settings.get(APPLICATION_LOCK_SETTING_KEY))!.value,
    );
    expect(await cryptoService.verifyLockPassphrase(configuration, 'a-private-device-lock-phrase')).toBe(false);
    expect(await cryptoService.verifyLockPassphrase(configuration, 'a-new-device-lock-phrase')).toBe(true);

    lockService.lock();
    await expect(lockService.unlock('a-private-device-lock-phrase')).rejects.toThrow('Incorrect passphrase');
    await lockService.unlock('a-new-device-lock-phrase');
    await lockService.disable('a-new-device-lock-phrase');
    expect(lockService.configured()).toBe(false);
    expect(await database.settings.get(APPLICATION_LOCK_SETTING_KEY)).toBeUndefined();
  });

  it('keeps startup gated when stored lock metadata is malformed', async () => {
    database = new MyMoneyDatabase(`mymoney-lock-invalid-${crypto.randomUUID()}`);
    await database.settings.put({
      key: APPLICATION_LOCK_SETTING_KEY,
      value: '{"version":99}',
      updatedAt: new Date().toISOString(),
    });
    const lockService = new ApplicationLockService(database);
    await lockService.initialize();
    expect(lockService.initialized()).toBe(true);
    expect(lockService.initializationError()).toContain('unsupported cryptographic metadata');
    expect(lockService.locked()).toBe(false);
  });
});
