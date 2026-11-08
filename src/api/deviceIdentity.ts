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

/** The id is generated once per installation and then reused from localStorage. */
export function getDeviceId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && DEVICE_ID_PATTERN.test(stored)) return stored;
  } catch {
    // Storage unavailable: fall through to a fresh id for this page load.
  }
  const id = randomHex(16);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not persisted; the next load will generate another id.
  }
  return id;
}

/** "LG webOS TV", plus the model name when the platform reported one. */
export function deviceName(modelName?: string | null): string {
  const model = modelName?.trim();
  return model ? `LG webOS TV ${model}` : 'LG webOS TV';
}

export function getDeviceIdentity(modelName?: string | null): DeviceIdentity {
  return { id: getDeviceId(), name: deviceName(modelName) };
}
