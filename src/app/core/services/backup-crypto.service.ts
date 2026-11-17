import { Injectable } from '@angular/core';
import { APPLICATION_LOCK_SETTING_KEY } from '../security/security.constants';

export { APPLICATION_LOCK_SETTING_KEY } from '../security/security.constants';
export const BACKUP_FORMAT = 'mymoney-encrypted-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_KDF_ITERATIONS = 600_000;
export const BACKUP_MAX_FILE_BYTES = 100 * 1024 * 1024;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;
const GCM_TAG_BITS = 128;
const LOCK_VERIFIER_CONTEXT = new TextEncoder().encode('MyMoney application lock verifier v1');
const MINIMUM_PASSPHRASE_LENGTH = 12;

export interface ApplicationLockConfiguration {
  version: 1;
  iterations: number;
  salt: string;
  verifier: string;
}

export interface EncryptedBackupEnvelope {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  schemaVersion: number;
  createdAt: string;
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: typeof BACKUP_KDF_ITERATIONS;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    iv: string;
    tagLength: typeof GCM_TAG_BITS;
  };
  ciphertext: string;
}

@Injectable({ providedIn: 'root' })
export class BackupCryptoService {
  async createLockConfiguration(passphrase: string): Promise<ApplicationLockConfiguration> {
    validatePassphrase(passphrase);
    this.requireWebCrypto();
    const salt = randomBytes(SALT_BYTES);
    const verifier = await this.deriveLockVerifier(passphrase, salt);
    return {
      version: 1,
      iterations: BACKUP_KDF_ITERATIONS,
      salt: encodeBase64(salt),
      verifier: encodeBase64(verifier),
    };
  }

  parseLockConfiguration(serialized: string): ApplicationLockConfiguration {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('Saved application-lock settings are invalid or corrupted. Financial data has not been changed.');
    }

    if (!isRecord(value) || value['version'] !== 1 || value['iterations'] !== BACKUP_KDF_ITERATIONS) {
      throw new Error('Saved application-lock settings use unsupported cryptographic metadata.');
    }
    const salt = decodeBase64(value['salt'], 'Saved application-lock salt is invalid.');
    const verifier = decodeBase64(value['verifier'], 'Saved application-lock verifier is invalid.');
    if (salt.length !== SALT_BYTES || verifier.length !== 32) {
      throw new Error('Saved application-lock metadata is invalid.');
    }
    return {
      version: 1,
      iterations: BACKUP_KDF_ITERATIONS,
      salt: encodeBase64(salt),
      verifier: encodeBase64(verifier),
    };
  }

  async verifyLockPassphrase(
    configuration: ApplicationLockConfiguration,
    passphrase: string,
  ): Promise<boolean> {
    validatePassphrase(passphrase);
    const salt = decodeBase64(configuration.salt, 'Saved application-lock salt is invalid.');
    const expected = decodeBase64(configuration.verifier, 'Saved application-lock verifier is invalid.');
    if (
      configuration.version !== 1 ||
      configuration.iterations !== BACKUP_KDF_ITERATIONS ||
      salt.length !== SALT_BYTES ||
      expected.length !== 32
    ) {
      throw new Error('Saved application-lock metadata is invalid.');
    }
    const actual = await this.deriveLockVerifier(passphrase, salt);
    return constantTimeEqual(actual, expected);
  }

  async encryptBackup(
    plaintext: string,
    passphrase: string,
    schemaVersion: number,
  ): Promise<string> {
    validatePassphrase(passphrase);
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
      throw new Error('The database schema version is invalid.');
    }
    this.requireWebCrypto();

    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const createdAt = new Date().toISOString();
    const header = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion,
      createdAt,
      kdf: {
        name: 'PBKDF2' as const,
        hash: 'SHA-256' as const,
        iterations: BACKUP_KDF_ITERATIONS,
        salt: encodeBase64(salt),
      },
      cipher: {
        name: 'AES-GCM' as const,
        iv: encodeBase64(iv),
        tagLength: GCM_TAG_BITS,
      },
    } satisfies Omit<EncryptedBackupEnvelope, 'ciphertext'>;
    const encodedPlaintext = new TextEncoder().encode(plaintext);
    if (encodedPlaintext.byteLength > BACKUP_MAX_FILE_BYTES) {
      throw new Error('The backup is too large to encrypt in this browser.');
    }
    const key = await this.deriveAesKey(passphrase, salt, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: new TextEncoder().encode(JSON.stringify(header)),
        tagLength: GCM_TAG_BITS,
      },
      key,
      encodedPlaintext,
    );
    const envelope: EncryptedBackupEnvelope = {
      ...header,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    };
    return JSON.stringify(envelope);
  }

  async decryptBackup(
    serializedEnvelope: string,
    passphrase: string,
    expectedSchemaVersion: number,
  ): Promise<string> {
    validatePassphrase(passphrase);
    this.requireWebCrypto();
    if (byteLength(serializedEnvelope) > BACKUP_MAX_FILE_BYTES) {
      throw new Error('The selected backup exceeds the supported file size.');
    }
    const envelope = this.parseEnvelope(serializedEnvelope, expectedSchemaVersion);
    const salt = decodeBase64(envelope.kdf.salt, 'Backup salt is invalid.');
    const iv = decodeBase64(envelope.cipher.iv, 'Backup initialization vector is invalid.');
    const ciphertext = decodeBase64(envelope.ciphertext, 'Backup ciphertext is invalid.');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ciphertext.length < GCM_TAG_BITS / 8) {
      throw new Error('Backup cryptographic metadata or ciphertext is incomplete.');
    }

    const header = {
      format: envelope.format,
      formatVersion: envelope.formatVersion,
      schemaVersion: envelope.schemaVersion,
      createdAt: envelope.createdAt,
      kdf: envelope.kdf,
      cipher: envelope.cipher,
    };
    try {
      const key = await this.deriveAesKey(passphrase, salt, ['decrypt']);
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: toArrayBuffer(iv),
          additionalData: new TextEncoder().encode(JSON.stringify(header)),
          tagLength: GCM_TAG_BITS,
        },
        key,
        toArrayBuffer(ciphertext),
      );
      return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
    } catch {
      throw new Error('Unable to decrypt the backup. The passphrase may be wrong, or the file may be corrupted or tampered with.');
    }
  }

  private parseEnvelope(serialized: string, expectedSchemaVersion: number): EncryptedBackupEnvelope {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      throw new Error('This is not a valid MyMoney backup file.');
    }
    if (!isRecord(value)) throw new Error('This is not a valid MyMoney backup file.');
    if (value['format'] !== BACKUP_FORMAT) throw new Error('This file is not a MyMoney encrypted backup.');
    if (value['formatVersion'] !== BACKUP_FORMAT_VERSION) {
      throw new Error(`Unsupported backup format version: ${String(value['formatVersion'])}.`);
    }
    const schemaVersion = value['schemaVersion'];
    if (!Number.isSafeInteger(schemaVersion) || schemaVersion !== expectedSchemaVersion) {
      throw new Error(`Unsupported database schema version: ${String(schemaVersion)}.`);
    }
    const createdAt = value['createdAt'];
    if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error('Backup creation date is invalid.');
    }
    const kdf = value['kdf'];
    if (
      !isRecord(kdf) ||
      kdf['name'] !== 'PBKDF2' ||
      kdf['hash'] !== 'SHA-256' ||
      kdf['iterations'] !== BACKUP_KDF_ITERATIONS ||
      typeof kdf['salt'] !== 'string'
    ) {
      throw new Error('Backup key-derivation metadata is invalid or unsupported.');
    }
    const cipher = value['cipher'];
    if (
      !isRecord(cipher) ||
      cipher['name'] !== 'AES-GCM' ||
      cipher['tagLength'] !== GCM_TAG_BITS ||
      typeof cipher['iv'] !== 'string'
    ) {
      throw new Error('Backup encryption metadata is invalid or unsupported.');
    }
    const ciphertext = value['ciphertext'];
    if (typeof ciphertext !== 'string' || !ciphertext) {
      throw new Error('Backup ciphertext is missing.');
    }
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion,
      createdAt,
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: BACKUP_KDF_ITERATIONS,
        salt: kdf['salt'],
      },
      cipher: {
        name: 'AES-GCM',
        iv: cipher['iv'],
        tagLength: GCM_TAG_BITS,
      },
      ciphertext,
    };
  }

  private async deriveLockVerifier(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
    this.requireWebCrypto();
    const bits = await this.deriveBits(passphrase, salt, 512, BACKUP_KDF_ITERATIONS);
    const verifierKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(bits.slice(32, 64)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return new Uint8Array(await crypto.subtle.sign('HMAC', verifierKey, LOCK_VERIFIER_CONTEXT));
  }

  private async deriveAesKey(
    passphrase: string,
    salt: Uint8Array,
    usages: KeyUsage[],
  ): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: BACKUP_KDF_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: AES_KEY_BITS },
      false,
      usages,
    );
  }

  private async deriveBits(
    passphrase: string,
    salt: Uint8Array,
    length: number,
    iterations: number,
  ): Promise<Uint8Array> {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
      material,
      length,
    );
    return new Uint8Array(bits);
  }

  private requireWebCrypto(): void {
    if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
      throw new Error('Web Crypto is unavailable in this browser or origin. Open MyMoney in a secure context.');
    }
  }
}

export function validatePassphrase(passphrase: string): void {
  if (typeof passphrase !== 'string' || passphrase.length < MINIMUM_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must contain at least ${MINIMUM_PASSPHRASE_LENGTH} characters.`);
  }
  if (passphrase.length > 1_024) throw new Error('Passphrase is too long.');
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: unknown, errorMessage: string): Uint8Array {
  if (typeof value !== 'string' || value.length === 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(errorMessage);
  }
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (encodeBase64(bytes) !== value) throw new Error(errorMessage);
    return bytes;
  } catch {
    throw new Error(errorMessage);
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
