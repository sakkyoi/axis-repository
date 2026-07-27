import type { DurableStorage } from "../storage/durable-state";

/**
 * Storage double that also keeps an alarm, which the object relies on to renew
 * published metadata before it expires.
 */
export class FakeDurableObjectStorage implements DurableStorage {
  readonly values = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    for (const [key, value] of this.values) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value as T);
      }
    }
    return result;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

/** Enough of `DurableObjectState` for the object to construct and run alarms. */
export function fakeDurableObjectState(
  storage: FakeDurableObjectStorage = new FakeDurableObjectStorage(),
): { storage: FakeDurableObjectStorage; blockConcurrencyWhile<T>(run: () => Promise<T>): Promise<T> } {
  return {
    storage,
    blockConcurrencyWhile: (run) => run(),
  };
}
