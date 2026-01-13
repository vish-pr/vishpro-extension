/**
 * Time-Bucketed Counter with Multi-Tier Aggregation
 *
 * Tiers:
 * - minute: 1-minute buckets, keeps last 60 (1 hour of fine granularity)
 * - hour: 1-hour buckets, keeps last 24 (1 day of medium granularity)
 * - day: 1-day buckets, keeps last 30 (1 month of coarse granularity)
 *
 * Older data automatically rolls up into coarser buckets.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TIERS = {
  minute: { duration: MINUTE, retention: 60 },
  hour: { duration: HOUR, retention: 24 },
  day: { duration: DAY, retention: 30 }
};

function getBucketTimestamp(time, duration) {
  return Math.floor(time / duration) * duration;
}

function createEmptyData() {
  return { minute: [], hour: [], day: [] };
}

export class TimeBucketCounter {
  constructor(storageKey, storage = null) {
    this.storageKey = storageKey;
    this.storage = storage;
    this.data = {};
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    if (this.storage) {
      const result = await this.storage.get([this.storageKey]);
      this.data = result[this.storageKey] || {};
    }
    this.loaded = true;
  }

  async save() {
    if (this.storage) {
      await this.storage.set({ [this.storageKey]: this.data });
    }
  }

  async increment(key, counter = 'count', amount = 1) {
    await this.load();
    const now = Date.now();

    if (!this.data[key]) {
      this.data[key] = {};
    }
    if (!this.data[key][counter]) {
      this.data[key][counter] = createEmptyData();
    }

    const buckets = this.data[key][counter];
    const bucketTs = getBucketTimestamp(now, MINUTE);

    // Find or create minute bucket
    let bucket = buckets.minute.find(b => b.ts === bucketTs);
    if (!bucket) {
      bucket = { ts: bucketTs, count: 0 };
      buckets.minute.push(bucket);
    }
    bucket.count += amount;

    // Aggregate and prune
    this._aggregate(buckets, now);

    await this.save();
  }

  _aggregate(buckets, now) {
    // Roll up old minute buckets to hour buckets
    const hourCutoff = now - (TIERS.minute.retention * MINUTE);
    const expiredMinutes = buckets.minute.filter(b => b.ts < hourCutoff);

    for (const mb of expiredMinutes) {
      const hourTs = getBucketTimestamp(mb.ts, HOUR);
      let hourBucket = buckets.hour.find(b => b.ts === hourTs);
      if (!hourBucket) {
        hourBucket = { ts: hourTs, count: 0 };
        buckets.hour.push(hourBucket);
      }
      hourBucket.count += mb.count;
    }
    buckets.minute = buckets.minute.filter(b => b.ts >= hourCutoff);

    // Roll up old hour buckets to day buckets
    const dayCutoff = now - (TIERS.hour.retention * HOUR);
    const expiredHours = buckets.hour.filter(b => b.ts < dayCutoff);

    for (const hb of expiredHours) {
      const dayTs = getBucketTimestamp(hb.ts, DAY);
      let dayBucket = buckets.day.find(b => b.ts === dayTs);
      if (!dayBucket) {
        dayBucket = { ts: dayTs, count: 0 };
        buckets.day.push(dayBucket);
      }
      dayBucket.count += hb.count;
    }
    buckets.hour = buckets.hour.filter(b => b.ts >= dayCutoff);

    // Prune old day buckets
    const monthCutoff = now - (TIERS.day.retention * DAY);
    buckets.day = buckets.day.filter(b => b.ts >= monthCutoff);

    // Sort all tiers
    buckets.minute.sort((a, b) => a.ts - b.ts);
    buckets.hour.sort((a, b) => a.ts - b.ts);
    buckets.day.sort((a, b) => a.ts - b.ts);
  }

  async getTotal(key, counter = 'count', since = 0) {
    await this.load();

    if (!this.data[key]?.[counter]) return 0;

    const buckets = this.data[key][counter];
    let total = 0;

    for (const tier of ['minute', 'hour', 'day']) {
      for (const b of buckets[tier]) {
        if (b.ts >= since) {
          total += b.count;
        }
      }
    }

    return total;
  }

  async getStats(key) {
    await this.load();

    if (!this.data[key]) return null;

    const now = Date.now();
    const stats = {};

    for (const [counter, buckets] of Object.entries(this.data[key])) {
      // Read-only: compute stats without mutating data
      // Aggregation happens only during increment() to avoid race conditions
      const lastHour = now - HOUR;
      const lastDay = now - DAY;

      stats[counter] = {
        total: this._sumBuckets(buckets, 0),
        lastHour: this._sumBuckets(buckets, lastHour),
        lastDay: this._sumBuckets(buckets, lastDay),
        buckets: {
          minute: buckets.minute.length,
          hour: buckets.hour.length,
          day: buckets.day.length
        }
      };
    }

    return stats;
  }

  _sumBuckets(buckets, since) {
    let total = 0;
    for (const tier of ['minute', 'hour', 'day']) {
      for (const b of buckets[tier]) {
        if (b.ts >= since) total += b.count;
      }
    }
    return total;
  }

  async getAllStats() {
    await this.load();

    const result = {};
    for (const key of Object.keys(this.data)) {
      result[key] = await this.getStats(key);
    }
    return result;
  }

  async getBuckets(key, counter = 'count', tier = 'minute') {
    await this.load();

    if (!this.data[key]?.[counter]) return [];
    return [...this.data[key][counter][tier]];
  }

  async reset(key = null) {
    await this.load();

    if (key) {
      delete this.data[key];
    } else {
      this.data = {};
    }

    await this.save();
  }

  async keys() {
    await this.load();
    return Object.keys(this.data);
  }
}

// Singleton instance for model stats
let modelStatsCounter = null;

export function getModelStatsCounter() {
  if (!modelStatsCounter) {
    modelStatsCounter = new TimeBucketCounter('modelStatsV2', {
      get: keys => chrome.storage.local.get(keys),
      set: items => chrome.storage.local.set(items)
    });
  }
  return modelStatsCounter;
}
