/**
 * حداقل شکل یک «راس ذخیره‌شده» که `match.ts` به آن نیاز دارد.
 *
 * در سایت، `T_raas` کامل (با `user_id` و ...) پاس داده می‌شود و چون
 * این نوع ساختاری است، بدون تبدیل جور در می‌آید. نسخه‌ی ویندوز هم
 * ردیف‌های SQLite را با همین شکل می‌سازد.
 */
export type RaasDocKind = 'check' | 'invoice';
export type RaasTermUnit = 'day' | 'month';

export type RaasGroupRow = {
   created_at: string | Date;
   amount: number;
   base_date: string | Date;
   days_diff: number;
   term_days?: number | null;
};

export type RaasGroup = {
   total_price?: number | null;
   average_days_number?: number | null;
   checks?: RaasGroupRow[];
};
