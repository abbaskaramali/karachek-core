import type { OfflineLease } from './protocol';

export const DEFAULT_LEASE_DAYS = 7;
const DAY_MS = 86400000;

/** پایان مجوز: ۷ روز از حالا یا پایان اشتراک — هر کدام زودتر */
export const lease_expiry = (
   now: Date,
   membership_ends_at: Date | null,
   lease_days: number = DEFAULT_LEASE_DAYS,
): Date => {
   const by_days = new Date(now.getTime() + lease_days * DAY_MS);
   if (membership_ends_at && membership_ends_at.getTime() < by_days.getTime()) return membership_ends_at;
   return by_days;
};

export type LeaseState = 'valid' | 'expired' | 'missing';

export const lease_state = (lease: Pick<OfflineLease, 'expires_at'> | null | undefined, now: Date = new Date()): LeaseState => {
   if (!lease) return 'missing';
   const exp = Date.parse(lease.expires_at);
   if (!Number.isFinite(exp)) return 'missing';
   return now.getTime() < exp ? 'valid' : 'expired';
};
