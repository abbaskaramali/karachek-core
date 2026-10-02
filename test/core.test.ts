import { describe, expect, it } from 'vitest';
import {
   calculateInstallment,
   raas_average_days_exact,
   raas_net_amount,
   match_raas,
   addDaysToJalali,
   jalaliToIsoSafe,
   new_record_id,
   is_record_id,
   resolve_conflict,
   lease_expiry,
   lease_state,
} from '../src';

describe('installment', () => {
   it('simple interest, fixed count', () => {
      const r = calculateInstallment({
         mode: 'COUNT',
         total_loan: 120_000_000,
         prepayment: 0,
         monthly_rate: 0,
         interest_type: 'SIMPLE',
         rounding_strategy: 'EXACT',
         count: 12,
         start_date: '1405/01/01',
      });
      expect(r.is_valid).toBe(true);
      expect(r.installments).toHaveLength(12);
      expect(Math.round(r.total_payment)).toBe(120_000_000);
      expect(r.monthly_payment).toBe(10_000_000);
   });
});

describe('raas', () => {
   it('weighted average days by amount', () => {
      const d = raas_average_days_exact([
         { amount: 100, days_diff: 10 },
         { amount: 300, days_diff: 30 },
      ]);
      expect(d).toBe(25);
   });

   it('net amount modes', () => {
      expect(raas_net_amount(1000, 100, 'SUBTRACT')).toBe(900);
      expect(raas_net_amount(1000, 100, 'ADD')).toBe(1100);
   });

   it('match: checks 30 days later → positive interest on invoice total', () => {
      const base = '2026-01-01T00:00:00.000Z';
      const invoice = { total_price: 1_000_000, average_days_number: 0, checks: [{ created_at: base, amount: 1_000_000, base_date: base, days_diff: 0 }] };
      const checks = { total_price: 1_000_000, average_days_number: 30, checks: [{ created_at: base, amount: 1_000_000, base_date: base, days_diff: 30 }] };
      const m = match_raas(invoice, checks, 3)!;
      expect(m.gap_days).toBe(30);
      expect(m.direction).toBe('later');
      expect(Math.round(m.interest)).toBe(30_000);
   });
});

describe('jalali utils', () => {
   it('adds days across month boundary', () => {
      expect(addDaysToJalali('1405/01/31', 1)).toBe('1405/02/01');
      expect(jalaliToIsoSafe('1405/01/01')).toMatch(/^2026-03-21/);
   });
});

describe('sync', () => {
   it('record id is ObjectId-compatible and unique', () => {
      const a = new_record_id();
      const b = new_record_id();
      expect(is_record_id(a)).toBe(true);
      expect(a).not.toBe(b);
      expect(parseInt(a.slice(0, 8), 16)).toBeCloseTo(Date.now() / 1000, -1);
   });

   it('last write wins, server wins ties', () => {
      const meta = (t: string) => ({ id: 'x', created_at: t, updated_at: t, deleted: false });
      expect(resolve_conflict(null, meta('2026-01-01T00:00:00Z'))).toBe('incoming');
      expect(resolve_conflict(meta('2026-01-01T00:00:00Z'), meta('2026-01-02T00:00:00Z'))).toBe('incoming');
      expect(resolve_conflict(meta('2026-01-02T00:00:00Z'), meta('2026-01-01T00:00:00Z'))).toBe('server');
      expect(resolve_conflict(meta('2026-01-01T00:00:00Z'), meta('2026-01-01T00:00:00Z'))).toBe('server');
   });

   it('lease: 7 days or membership end, whichever first', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      expect(lease_expiry(now, null).toISOString()).toBe('2026-01-08T00:00:00.000Z');
      const end = new Date('2026-01-03T00:00:00Z');
      expect(lease_expiry(now, end)).toBe(end);
      expect(lease_state({ expires_at: '2026-01-08T00:00:00Z' }, now)).toBe('valid');
      expect(lease_state({ expires_at: '2025-12-31T00:00:00Z' }, now)).toBe('expired');
      expect(lease_state(null, now)).toBe('missing');
   });
});
