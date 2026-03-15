import type { ExplanationMode, ExplanationRecord } from '../types';

interface CacheEntry {
  expiresAt: number;
  record: ExplanationRecord;
}

export class ExplanationCache {
  private ttlMs: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<ExplanationRecord>>();

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  public updateTtl(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  public get(key: string, sourceVersion?: number): ExplanationRecord | undefined {
    this.pruneExpired();
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (typeof sourceVersion === 'number' && entry.record.sourceVersion !== sourceVersion) {
      return undefined;
    }

    return entry.record;
  }

  public set(record: ExplanationRecord): ExplanationRecord {
    const existing = this.entries.get(record.key)?.record;
    const merged: ExplanationRecord = {
      key: record.key,
      createdAt: record.createdAt,
      sourceVersion: record.sourceVersion,
      summary: record.summary.length > 0 ? record.summary : existing?.summary ?? [],
      detailMarkdown: record.detailMarkdown ?? existing?.detailMarkdown
    };

    this.entries.set(record.key, {
      expiresAt: Date.now() + this.ttlMs,
      record: merged
    });

    return merged;
  }

  public async getOrCreate(
    key: string,
    mode: ExplanationMode,
    producer: () => Promise<ExplanationRecord>,
    sourceVersion?: number
  ): Promise<ExplanationRecord> {
    const cached = this.get(key, sourceVersion);
    if (cached && this.hasMode(cached, mode)) {
      return cached;
    }

    const inFlightKey = `${key}:${mode}`;
    const existingPromise = this.inFlight.get(inFlightKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = producer()
      .then(record => this.set(record))
      .finally(() => {
        this.inFlight.delete(inFlightKey);
      });

    this.inFlight.set(inFlightKey, promise);
    return promise;
  }

  private hasMode(record: ExplanationRecord, mode: ExplanationMode): boolean {
    if (mode === 'summary') {
      return record.summary.length > 0;
    }

    return typeof record.detailMarkdown === 'string' && record.detailMarkdown.trim().length > 0;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
