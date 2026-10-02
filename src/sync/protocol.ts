/**
 * ═══════════════════════════════════════════════════════════════════
 *  قرارداد همگام‌سازی بین سرور (سایت) و نسخه‌های نصبی
 * ═══════════════════════════════════════════════════════════════════
 *  هر دو طرف همین نوع‌ها را import می‌کنند؛ تغییر یک فیلد فقط اینجا
 *  انجام می‌شود و کامپایلر هر دو طرف را مجبور به هماهنگی می‌کند.
 *
 *  قواعد:
 *   - هر رکورد `id` (قالب ObjectId، ساخته‌شده روی دستگاه یا سرور)،
 *     `updated_at` (ISO) و `deleted` (حذف نرم) دارد.
 *   - تاریخ‌ها روی سیم همیشه رشته‌ی ISO هستند (نه Date).
 *   - `user_id` روی سیم نیست: سرور از توکن می‌فهمد.
 *   - ترتیب اتصال: اول push (صف outbox دستگاه)، بعد pull.
 *   - تعارض: آخرین `updated_at` برنده است (`resolve_conflict`).
 * ═══════════════════════════════════════════════════════════════════
 */
import type { InstallmentScheduleItem } from '../installment/types';
import type { RaasDocKind, RaasTermUnit } from '../raas/types';

export const SYNC_PROTOCOL_VERSION = 1;

export type SyncMeta = {
   id: string;
   created_at: string;
   updated_at: string;
   deleted: boolean;
};

export type CheckType = 'receivalble' | 'payable' | 'transferred';
export type CheckStatus = 'pending' | 'passed' | 'bounced';

export type SyncCheck = SyncMeta & {
   type: CheckType;
   bank: string;
   party_name: string;
   national_code?: string | null;
   phone?: string | null;
   amount: number;
   sayadi_id?: string | null;
   status: CheckStatus;
   due_at: string;
   transferred_to?: string | null;
   check_serial?: string | null;
   check_series?: string | null;
   medium?: 'paper' | 'digital';
   active: boolean;
};

export type SyncRaas = SyncMeta & {
   total_price: number;
   raaschecks_number: number;
   average_days_number: number;
   monthly_rate: number;
   total_interest_price: number;
   income_price: number;
   name?: string | null;
   doc_kind?: RaasDocKind;
   day_rounding?: 'ROUND_UP' | 'ROUND_DOWN' | 'NONE';
   ignore_amount?: boolean;
   interest_mode?: 'SUBTRACT' | 'ADD';
   active: boolean;
   user_saved: boolean;
};

export type SyncRaasCheck = SyncMeta & {
   amount: number;
   due_at: string;
   base_date: string;
   base_date_manual?: boolean;
   issued_at?: string | null;
   term_days?: number | null;
   days_diff: number;
   doc_kind?: RaasDocKind;
   doc_number?: string | null;
   term_unit?: RaasTermUnit;
   term_value?: number | null;
   /** شناسه‌ی راس والد (همان `id` رکورد SyncRaas) */
   raas_id?: string | null;
   active: boolean;
};

export type SyncInstallment = SyncMeta & {
   type: 'installment_number' | 'installment_price';
   mode?: 'COUNT' | 'AMOUNT' | 'CHECK_COUNT' | 'CHECK_AMOUNT';
   interest_type?: 'SIMPLE' | 'FIXED_PRINCIPAL' | 'AVERAGE_BALANCE' | 'COMPOUND' | 'MARKET';
   total_loan: number;
   prepayment: number;
   monthly_rate: number;
   installments_number: number;
   monthly_price: number;
   total_interest: number;
   total_refund: number;
   day_rounding?: 'NONE' | 'ROUND_UP' | 'ROUND_DOWN';
   start_date?: string | null;
   rounding_strategy?: string;
   check_interval_months?: number;
   check_count?: number | null;
   check_amount?: number | null;
   target_payment?: number | null;
   calculated_schedule?: InstallmentScheduleItem[];
   installment_schedule?: InstallmentScheduleItem[];
   name?: string | null;
   product_name?: string | null;
   user_saved?: boolean;
   active: boolean;
};

export type SyncEntityMap = {
   check: SyncCheck;
   raas: SyncRaas;
   raas_check: SyncRaasCheck;
   installment: SyncInstallment;
};

export type SyncEntity = keyof SyncEntityMap;

/**
 * ترتیب اعمال: والد قبل از فرزند (raas قبل از raas_check) تا ارجاع
 * `raas_id` هیچ‌وقت به رکوردی اشاره نکند که هنوز نرسیده.
 */
export const SYNC_ENTITIES: readonly SyncEntity[] = ['check', 'raas', 'raas_check', 'installment'];

export type SyncChange<E extends SyncEntity = SyncEntity> = {
   entity: E;
   record: SyncEntityMap[E];
};

/* ── ثبت دستگاه و مجوز آفلاین ─────────────────────────────────── */

export type DevicePlatform = 'windows' | 'android' | 'ios' | 'macos';

export type DeviceRegisterRequest = {
   device_id: string;
   platform: DevicePlatform;
   device_name: string;
   app_version: string;
};

/**
 * مجوز آفلاین زمان‌دار. سرور آن را امضا می‌کند (JWT)؛ دستگاه فقط
 * `expires_at` را می‌خواند و تا آن زمان بدون اینترنت کار می‌کند.
 * امضا برای این است که کاربر نتواند با ویرایش فایل محلی تمدیدش کند.
 */
export type OfflineLease = {
   token: string;
   device_id: string;
   user_id: string;
   issued_at: string;
   expires_at: string;
   /** پایان اشتراک کاربر، اگر دارد — lease هرگز از این دیرتر نیست */
   membership_ends_at: string | null;
};

export type DeviceRegisterResponse =
   | { ok: true; lease: OfflineLease; access_token: string }
   | { ok: false; reason: 'device_limit'; devices: { device_id: string; device_name: string; last_seen_at: string }[] };

/* ── push / pull ──────────────────────────────────────────────── */

export type SyncPushRequest = {
   protocol: number;
   device_id: string;
   changes: SyncChange[];
};

export type SyncPushResponse = {
   /** شناسه‌هایی که سرور پذیرفت (یا نسخه‌ی جدیدترش را داشت) — از outbox پاک شوند */
   accepted: string[];
   /** رکوردهایی که نسخه‌ی سرور جدیدتر بود؛ دستگاه باید این‌ها را جایگزین کند */
   superseded: SyncChange[];
   rejected: { id: string; message: string }[];
};

export type SyncPullRequest = {
   protocol: number;
   device_id: string;
   /** مقدار `cursor` پاسخ قبلی؛ null یعنی اولین همگام‌سازی (همه‌چیز) */
   cursor: string | null;
   limit?: number;
};

export type SyncPullResponse = {
   changes: SyncChange[];
   cursor: string;
   has_more: boolean;
   /** lease تازه — هر pull موفق مجوز آفلاین را تمدید می‌کند */
   lease: OfflineLease;
};
