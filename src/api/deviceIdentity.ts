import { getPlatform } from '../platform';

const STORAGE_KEY = 'silo-lg.deviceId';
// Silo accepts letters, digits and . _ : - up to 128 characters; 32 hex characters fit easily.
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface DeviceIdentity {
  id: string;
  name: string;
}

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, '0')).join('');
}

/** The id is generated once per installation and then reused from platform storage. */
export function getDeviceId(): string {
  const { storage } = getPlatform();
  // Storage unavailable reads as nothing stored: a fresh id for this page load.
  const stored = storage.get(STORAGE_KEY);
  if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
  const id = randomHex(16);
  // Not persisted when storage is blocked; the next load will generate another id.
  storage.set(STORAGE_KEY, id);
  return id;
}

export function getDeviceIdentity(modelName?: string | null): DeviceIdentity {
  return { id: getDeviceId(), name: getPlatform().deviceLabel(modelName) };
}
