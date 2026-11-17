import { describe, expect, it } from 'vitest';
import { BackupCryptoService, BACKUP_KDF_ITERATIONS } from './backup-crypto.service';

describe('BackupCryptoService', () => {
  const cryptoService = new BackupCryptoService();
  const passphrase = 'a-private-backup-phrase';

  it('encrypts and decrypts with a fresh salt and IV for each export', async () => {
    const first = JSON.parse(await cryptoService.encryptBackup('{"records":[1,2]}', passphrase, 6));
    const second = JSON.parse(await cryptoService.encryptBackup('{"records":[1,2]}', passphrase, 6));

    expect(first.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: BACKUP_KDF_ITERATIONS });
    expect(first.cipher).toMatchObject({ name: 'AES-GCM', tagLength: 128 });
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.cipher.iv).not.toBe(second.cipher.iv);
    await expect(cryptoService.decryptBackup(JSON.stringify(first), passphrase, 6)).resolves.toBe('{"records":[1,2]}');
  });

  it('rejects an incorrect backup passphrase', async () => {
    const encrypted = await cryptoService.encryptBackup('private data', passphrase, 6);
    await expect(cryptoService.decryptBackup(encrypted, 'a-different-backup-phrase', 6))
      .rejects.toThrow('passphrase may be wrong');
  });

  it('rejects modified ciphertext and metadata before accepting plaintext', async () => {
    const encrypted = JSON.parse(await cryptoService.encryptBackup('private data', passphrase, 6));
    const ciphertext = atob(encrypted.ciphertext).split('');
    ciphertext[0] = String.fromCharCode(ciphertext[0].charCodeAt(0) ^ 1);
    encrypted.ciphertext = btoa(ciphertext.join(''));
    await expect(cryptoService.decryptBackup(JSON.stringify(encrypted), passphrase, 6))
      .rejects.toThrow('corrupted or tampered');

    encrypted.kdf.iterations = 1;
    await expect(cryptoService.decryptBackup(JSON.stringify(encrypted), passphrase, 6))
      .rejects.toThrow('key-derivation metadata');
  });

  it('reports unsupported format and schema versions distinctly', async () => {
    const encrypted = JSON.parse(await cryptoService.encryptBackup('private data', passphrase, 6));
    encrypted.formatVersion = 2;
    await expect(cryptoService.decryptBackup(JSON.stringify(encrypted), passphrase, 6))
      .rejects.toThrow('Unsupported backup format version');
    encrypted.formatVersion = 1;
    encrypted.schemaVersion = 5;
    await expect(cryptoService.decryptBackup(JSON.stringify(encrypted), passphrase, 6))
      .rejects.toThrow('Unsupported database schema version');
  });

  it('creates a salted lock verifier and changes it when the passphrase changes', async () => {
    const configuration = await cryptoService.createLockConfiguration(passphrase);
    expect(await cryptoService.verifyLockPassphrase(configuration, passphrase)).toBe(true);
    expect(await cryptoService.verifyLockPassphrase(configuration, 'a-wrong-lock-passphrase')).toBe(false);
    const replacement = await cryptoService.createLockConfiguration('a-new-private-lock-phrase');
    expect(replacement.salt).not.toBe(configuration.salt);
    expect(await cryptoService.verifyLockPassphrase(replacement, 'a-new-private-lock-phrase')).toBe(true);
    expect(await cryptoService.verifyLockPassphrase(replacement, passphrase)).toBe(false);
  });

  it('rejects malformed encrypted backup input and short passphrases', async () => {
    await expect(cryptoService.decryptBackup('{"format":"nope"}', passphrase, 6))
      .rejects.toThrow('not a MyMoney encrypted backup');
    await expect(cryptoService.encryptBackup('private data', 'short', 6))
      .rejects.toThrow('at least 12 characters');
  });
});
