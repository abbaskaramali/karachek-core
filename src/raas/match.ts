import type { RaasGroup as T_raas } from './types';
import { raas_date_from, raas_average_days_exact } from './calc';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  تطبیق تسویه — راس چک‌های دریافتی در برابر راس فاکتورها
 * ═══════════════════════════════════════════════════════════════════
 *  در بازار، مشتری در قبال چند فاکتور با سررسیدهای مختلف، چند چک با
 *  تاریخ‌های مختلف می‌دهد. سؤالِ فروشنده این نیست که «مبلغ‌ها برابرند؟»
 *  — سؤال این است که «آیا *ارزش زمانی* برابر است؟»
 *
 *  دو عدد باید کنار هم دیده شوند:
 *
 *   ۱) **اختلاف زمانی** = راس چک‌ها − راس فاکتورها.
 *      اگر مثبت باشد، مشتری بیش از توافق اعتبار گرفته: پولی که قرار بود
 *      در تاریخ الف برسد، در تاریخ ب می‌رسد.
 *
 *   ۲) **اختلاف مبلغ** = جمع چک‌ها − جمع فاکتورها.
 *      مشتری معمولاً همین اختلاف زمانی را با مبلغ بیشتر جبران می‌کند.
 *
 *  و بعد، بهره‌ی آن تأخیر:
 *
 *      بهره = جمعِ فاکتورها × نرخ ماهانه × (روزهای اختلاف ÷ ۳۰)
 *
 *  ⚠️ پایه‌ی بهره **جمع فاکتورهاست، نه جمع چک‌ها**. بدهیِ واقعی همان
 *  مبلغ فاکتورهاست؛ چک فقط ابزار پرداخت است. اگر روی جمع چک‌ها حساب
 *  می‌شد، هرچه مشتری بیشتر جبران می‌کرد جریمه‌اش هم بیشتر می‌شد — یعنی
 *  دقیقاً برعکسِ منطق.
 *
 *  ⚠️ ماه = ۳۰ روز. همان مبنایی که کل ماژول راس با آن کار می‌کند
 *  (بهره‌ی ماهانه ÷ ۳۰). استفاده از ماهِ تقویمیِ شمسی (۳۱ یا ۲۹ روزه)
 *  اینجا عدد را با فرمولِ بهره ناسازگار می‌کرد.
 * ═══════════════════════════════════════════════════════════════════
 */

const DAYS_PER_MONTH = 30;
const MS_PER_DAY = 86400000;

export type RaasMatchResult = {
   /** تاریخ راسِ هر گروه */
   invoice_date: Date;
   check_date: Date;
   /**
    * علامت‌دار: مثبت یعنی چک‌ها دیرتر از فاکتورها.
    * این عدد از فاصله‌ی دو *تاریخِ نمایش‌داده‌شده* می‌آید.
    */
   gap_days: number;
   /**
    * فاصله‌ی دقیق (کسری) — پیش از آنکه هر دو راس به روزِ تقویمی تبدیل شوند.
    *
    * ⚠️ این دو می‌توانند تا یک روز فرق کنند: هر راس جداگانه به «روزی که
    * لحظه‌ی دقیقش داخلش می‌افتد» تبدیل می‌شود، و دو بار جداگانه بریدنِ
    * کسر، تا یک روز اختلاف می‌سازد.
    *
    * پایه‌ی محاسبه عمداً `gap_days` است و نه این عدد: دو تاریخِ راس همان
    * چیزی هستند که طرفین به آن استناد می‌کنند، و اگر صفحه بگوید «۹۴ روز»
    * در حالی که ۱ مهر و ۶ دی را نشان می‌دهد، کاربر خودش ۹۵ می‌شمارد و به
    * عدد ما شک می‌کند. این مقدار برای شفافیت در راهنما نمایش داده می‌شود.
    */
   gap_days_exact: number;
   /** تجزیه‌ی |gap| به ماهِ ۳۰ روزه و روز */
   gap_months: number;
   gap_rest_days: number;
   direction: 'later' | 'earlier' | 'same';
   /** مبالغ به ریال */
   invoice_total: number;
   check_total: number;
   /** جمع چک‌ها منهای جمع فاکتورها (ریال) */
   amount_diff: number;
   /** بهره‌ی اختلافِ زمانی روی جمع فاکتورها (ریال، علامت‌دار) */
   interest: number;
   monthly_rate: number;
};

/**
 * روز راسِ یک راسِ ذخیره‌شده.
 *
 * ⚠️ مقدارِ ذخیره‌شده اولویت دارد و دوباره حساب نمی‌شود: بهره و مبلغ
 * دریافتیِ آن رکورد با همان عدد و با تنظیمِ گردکردنِ *زمانِ ذخیره* حساب
 * شده‌اند. بازمحاسبه با تنظیمِ امروز، دو عدد ناسازگار می‌سازد.
 * بازمحاسبه فقط برای رکوردهای خیلی قدیمیِ بدون این فیلد است.
 */
const days_of_raas = (raas: T_raas): number => {
   if (raas.average_days_number != null && Number.isFinite(Number(raas.average_days_number))) {
      return Number(raas.average_days_number);
   }
   return raas_average_days_exact(raas.checks || []);
};

/**
 * مبدای یک راسِ ذخیره‌شده — از ردیف‌هایش خوانده می‌شود.
 *
 * ⚠️ بر اساس `created_at` مرتب می‌شود و نه ترتیبِ خامِ آرایه: ترتیبی که
 * دیتابیس در `$lookup` برمی‌گرداند تضمین‌شده نیست، و چاپ‌گر هم با همین
 * ترتیب مرتب می‌کند. بدون این، لیست و برگه‌ی چاپی می‌توانستند دو مبدای
 * متفاوت بردارند.
 *
 * همه‌ی ردیف‌های یک راس یک مبدا دارند (شرطِ معنادار بودنِ راس)، پس اولین
 * ردیف کافی است.
 */
const base_of_raas = (raas: T_raas): string | Date | null => {
   const rows = [...(raas.checks || [])].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
   );
   return rows[0]?.base_date ?? null;
};

/** تاریخ راسِ یک گروهِ ذخیره‌شده — یا null اگر ردیف‌هایش در دسترس نباشند */
export const raas_group_date = (raas: T_raas | null | undefined): Date | null => {
   if (!raas) return null;
   return raas_date_from(base_of_raas(raas), days_of_raas(raas));
};

/** جمع مبالغِ یک گروه (ریال) — مقدار ذخیره‌شده، وگرنه از ردیف‌ها */
export const raas_group_total = (raas: T_raas | null | undefined): number => {
   if (!raas) return 0;
   if (raas.total_price != null && Number.isFinite(Number(raas.total_price))) {
      return Number(raas.total_price);
   }
   return (raas.checks || []).reduce((s, c) => s + c.amount, 0);
};

/**
 * تطبیق یک گروه فاکتور با یک گروه چک.
 *
 * `null` یعنی یکی از دو گروه تاریخ راس ندارد — معمولاً چون ردیف‌هایش
 * همراه رکورد بارگذاری نشده‌اند. در آن حالت به‌جای نشان‌دادن عددِ حدسی،
 * چیزی نشان داده نمی‌شود.
 */
export const match_raas = (
   invoice_raas: T_raas | null | undefined,
   check_raas: T_raas | null | undefined,
   monthly_rate: number,
): RaasMatchResult | null => {
   const invoice_date = raas_group_date(invoice_raas);
   const check_date = raas_group_date(check_raas);
   if (!invoice_date || !check_date) return null;

   const gap_days = Math.round((check_date.getTime() - invoice_date.getTime()) / MS_PER_DAY);
   const abs = Math.abs(gap_days);

   // فاصله‌ی دقیق، بدون بریدنِ کسرِ هر دو راس — فقط برای نمایش در راهنما
   const gap_days_exact =
      (new Date(base_of_raas(check_raas!) ?? 0).getTime()
         - new Date(base_of_raas(invoice_raas!) ?? 0).getTime()) / MS_PER_DAY
      + days_of_raas(check_raas!) - days_of_raas(invoice_raas!);

   const invoice_total = raas_group_total(invoice_raas);
   const check_total = raas_group_total(check_raas);

   return {
      invoice_date,
      check_date,
      gap_days,
      gap_days_exact,
      gap_months: Math.floor(abs / DAYS_PER_MONTH),
      gap_rest_days: abs % DAYS_PER_MONTH,
      direction: gap_days > 0 ? 'later' : gap_days < 0 ? 'earlier' : 'same',
      invoice_total,
      check_total,
      amount_diff: check_total - invoice_total,
      // پایه: جمع فاکتورها (بدهیِ واقعی)، نه جمع چک‌ها.
      interest: invoice_total * (monthly_rate / 100) * (gap_days / DAYS_PER_MONTH),
      monthly_rate,
   };
};

/** «۳ ماه و ۵ روز» — و برای صفر، «هم‌زمان» */
export const format_gap = (months: number, days: number): string => {
   if (months === 0 && days === 0) return 'هم‌زمان';
   const parts: string[] = [];
   if (months > 0) parts.push(`${months} ماه`);
   if (days > 0) parts.push(`${days} روز`);
   return parts.join(' و ');
};
