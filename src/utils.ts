// Simple number to Persian words converter
const ones = ['', 'یک', 'دو', 'سه', 'چهار', 'پنج', 'شش', 'هفت', 'هشت', 'نه'];
const teens = ['ده', 'یازده', 'دوازده', 'سیزده', 'چهارده', 'پانزده', 'شانزده', 'هفده', 'هجده', 'نوزده'];
const tens = ['', '', 'بیست', 'سی', 'چهل', 'پنجاه', 'شصت', 'هفتاد', 'هشتاد', 'نود'];
const hundreds = ['', 'صد', 'دویست', 'سیصد', 'چهارصد', 'پانصد', 'ششصد', 'هفتصد', 'هشتصد', 'نهصد'];
const thousands = ['', 'هزار', 'میلیون', 'میلیارد', 'تریلیون'];

// persian date to miladi date
import jalaali from 'jalaali-js';
/** ارقام فارسی/عربی را به لاتین تبدیل می‌کند و «/» را نگه می‌دارد */
export const toLatinDigitsKeepSlash = (s: string): string =>
   s.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632));

/** تعداد روزهای یک ماه شمسی (با احتساب اسفندِ کبیسه) */
const jalaliMonthLength = (jy: number, jm: number): number => {
   if (jm <= 6) return 31;
   if (jm <= 11) return 30;
   return jalaali.isLeapJalaaliYear(jy) ? 30 : 29;
};

/**
 * آیا رشته یک تاریخ شمسیِ *کامل و معتبر* است؟
 *
 * «کامل» یعنی هر سه بخش پر شده‌اند و سال چهار رقمی است. این تابع مخصوص
 * حالتی است که کاربر هنوز در حال تایپ کردن است: `۱۴۰۵/۰۵/۰` هنوز کامل نیست،
 * ولی خطا هم نیست — فقط باید صبر کرد.
 */
export const isCompleteJalaliDate = (jalaliDate?: string | null): boolean => {
   if (!jalaliDate) return false;
   const parts = toLatinDigitsKeepSlash(String(jalaliDate)).split('/');
   if (parts.length !== 3) return false;
   if (parts.some(p => p.trim() === '')) return false;
   const [jy, jm, jd] = parts.map(Number);
   if ([jy, jm, jd].some(n => isNaN(n))) return false;
   if (parts[0].trim().length !== 4) return false;
   if (jy < 1300 || jy > 1500) return false;
   if (jm < 1 || jm > 12) return false;
   if (jd < 1 || jd > jalaliMonthLength(jy, jm)) return false;
   return true;
};

/**
 * تبدیل تاریخ شمسی به ISO. اگر ورودی کامل/معتبر نباشد `null` برمی‌گرداند.
 *
 * ⚠ برای هر جایی که همراهِ تایپِ کاربر اجرا می‌شود (پیش‌نمایش زنده‌ی تعداد روز،
 * محاسبه‌ی لحظه‌ای و…) باید از **همین** نسخه استفاده شود، نه jalaliToIso.
 * چون کامپوننت تاریخ با هر کلید یک بار onChange می‌زند و مقدارهای نیمه‌کاره‌ای
 * مثل `۱۴۰۵/۰۵/۰` رد می‌شوند؛ اینها خطا نیستند، فقط هنوز کامل نشده‌اند.
 */
export const jalaliToIsoSafe = (jalaliDate?: string | null): string | null => {
   if (!isCompleteJalaliDate(jalaliDate)) return null;
   const [jy, jm, jd] = toLatinDigitsKeepSlash(String(jalaliDate)).split('/').map(Number);
   const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
   return new Date(Date.UTC(gy, gm - 1, gd)).toISOString();
};

/**
 * تبدیل تاریخ شمسی به ISO — برای جاهایی که تاریخ قطعاً کامل است
 * (ثبت نهایی، فیلتر، چاپ). در صورت نامعتبر بودن خطا می‌دهد تا داده‌ی غلط
 * بی‌سروصدا وارد دیتابیس نشود.
 *
 * تبدیل ارقام فارسی داخل خودِ تابع انجام می‌شود تا هیچ فراخوانی‌ای فراموشش نکند.
 */
export const jalaliToIso = (jalaliDate: string) => {
   const iso = jalaliToIsoSafe(jalaliDate);
   if (iso === null) {
      throw new Error(`تاریخ شمسی نامعتبر است: ${jalaliDate}`);
   }
   return iso;
};

/**
 * ═══════════════════════════════════════════════════════════════════
 *  حساب و کتابِ روز روی تقویم شمسی
 * ═══════════════════════════════════════════════════════════════════
 *  ⚠️ چرا با «شماره‌ی روز» و نه با Date میلادی؟
 *
 *  وسوسه‌ی اول این است که تاریخ شمسی را به Date تبدیل کنیم، چند روز
 *  جمع بزنیم و برگردانیم. این کار روی مرزِ ساعتِ تابستانی و به‌خاطر
 *  تایم‌زون، گاهی یک روز جابه‌جا جواب می‌دهد — و چون کل راس‌گیری
 *  روزشمار است، همان یک روز مستقیماً مبلغ بهره را عوض می‌کند.
 *
 *  `j2d` هر تاریخ شمسی را به یک عدد صحیح (شماره‌ی مطلقِ روز) تبدیل
 *  می‌کند. جمع و تفریق روی عدد صحیح انجام می‌شود، پس نه ساعت در کار
 *  است نه تایم‌زون نه کبیسه — و `d2j` عدد را دوباره به تاریخ شمسیِ
 *  درست برمی‌گرداند (اسفندِ ۳۰ روزه‌ی سال کبیسه هم خودکار رعایت
 *  می‌شود).
 * ═══════════════════════════════════════════════════════════════════
 */

/** تاریخ شمسی → شماره‌ی مطلق روز. برای تاریخ ناقص/نامعتبر: null */
export const jalaliToDayNumber = (jalaliDate?: string | null): number | null => {
   if (!isCompleteJalaliDate(jalaliDate)) return null;
   const [jy, jm, jd] = toLatinDigitsKeepSlash(String(jalaliDate)).split('/').map(Number);
   return jalaali.j2d(jy, jm, jd);
};

/** شماره‌ی مطلق روز → تاریخ شمسی `YYYY/MM/DD` */
export const dayNumberToJalali = (dayNumber: number): string => {
   const { jy, jm, jd } = jalaali.d2j(Math.round(dayNumber));
   return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`;
};

/**
 * تاریخ شمسی + تعداد روز → تاریخ شمسی.
 *
 * دقیقاً همان کاری که «تاریخ صدور فاکتور + مهلت تسویه» لازم دارد:
 * ۱۴۰۵/۰۳/۱۵ به‌علاوه‌ی ۴۰ روز می‌شود ۱۴۰۵/۰۴/۲۴ (طول ماه‌ها خودکار
 * رعایت می‌شود). ورودی ناقص → رشته‌ی خالی، تا حین تایپِ کاربر خطا
 * تولید نشود.
 */
export const addDaysToJalali = (jalaliDate: string | null | undefined, days: number): string => {
   const dn = jalaliToDayNumber(jalaliDate);
   if (dn === null || !Number.isFinite(days)) return '';
   return dayNumberToJalali(dn + Math.trunc(days));
};

/**
 * ═══════════════════════════════════════════════════════════════════
 *  تاریخ شمسی + تعداد ماه → تاریخ شمسی
 * ═══════════════════════════════════════════════════════════════════
 *  ⚠️ «ماه» اینجا **ماهِ تقویمی** است، نه ۳۰ روز — و این یک تصمیم است،
 *  نه جزئیاتِ پیاده‌سازی:
 *
 *  در بازار، «فاکتور ۲ ماهه» یعنی «همین روز، دو ماه بعد» — دقیقاً مثل
 *  «چک ۳ ماهه». اگر ۳۰ روز می‌گرفتیم، ۱ فروردین + ۲ ماه می‌شد
 *  ۳۰ اردیبهشت به‌جای ۱ خرداد؛ دو روز اختلاف که مستقیماً روی تاریخ
 *  تسویه می‌نشیند و کاربر می‌گوید «برنامه اشتباه حساب کرده».
 *
 *  ⚠️ روزِ سرریز بریده می‌شود: ۳۱ شهریور + ۱ ماه می‌شود ۳۰ مهر (مهر ۳۰
 *  روزه است) و نه ۱ آبان — همان قاعده‌ای که در سررسیدنویسی به کار
 *  می‌رود. پریدن به ماه بعد یعنی یک روز مهلتِ اضافه که طرفین بر سرش
 *  توافق نکرده‌اند.
 *
 *  اسفندِ سال کبیسه هم خودکار درست می‌شود.
 * ═══════════════════════════════════════════════════════════════════
 */
export const addMonthsToJalali = (jalaliDate: string | null | undefined, months: number): string => {
   if (!isCompleteJalaliDate(jalaliDate) || !Number.isFinite(months)) return '';
   const [jy, jm, jd] = toLatinDigitsKeepSlash(String(jalaliDate)).split('/').map(Number);

   // ماه‌ها روی یک محورِ خطی شمرده می‌شوند تا عبور از سال خودکار انجام شود
   const total = (jy * 12 + (jm - 1)) + Math.trunc(months);
   const target_y = Math.floor(total / 12);
   const target_m = ((total % 12) + 12) % 12 + 1;
   const target_d = Math.min(jd, jalaliMonthLength(target_y, target_m));

   return `${target_y}/${String(target_m).padStart(2, '0')}/${String(target_d).padStart(2, '0')}`;
};

/**
 * فاصله‌ی دو تاریخ شمسی به **ماهِ کامل** — یا `null` اگر فاصله دقیقاً
 * چند ماهِ تمام نباشد.
 *
 * ⚠️ چرا `null` و نه گِردکردن؟ این تابع یک کار دارد: وقتی کاربر تاریخ
 * سررسید را دستی عوض می‌کند، بفهمیم هنوز می‌شود مهلت را «به ماه» نشان
 * داد یا باید به «روز» برگشت. گِردکردن یعنی نوشتنِ «۲ ماه» برای
 * فاصله‌ای که ۶۳ روز است — یعنی دروغ گفتن درباره‌ی همان عددی که خودِ
 * کاربر وارد کرده.
 */
export const diffJalaliMonths = (from?: string | null, to?: string | null): number | null => {
   if (!isCompleteJalaliDate(from) || !isCompleteJalaliDate(to)) return null;
   const [fy, fm] = toLatinDigitsKeepSlash(String(from)).split('/').map(Number);
   const [ty, tm] = toLatinDigitsKeepSlash(String(to)).split('/').map(Number);
   const months = (ty * 12 + (tm - 1)) - (fy * 12 + (fm - 1));
   if (months < 0) return null;
   // فقط وقتی معتبر است که رفت‌وبرگشت دقیقاً به همان تاریخ برسد
   const normalized_to = toLatinDigitsKeepSlash(String(to))
      .split('/').map((p, i) => i === 0 ? p : String(Number(p)).padStart(2, '0')).join('/');
   return addMonthsToJalali(from, months) === normalized_to ? months : null;
};

/** نام ماه‌های شمسی — برای نمایشِ خوانا، نه محاسبه */
const JALALI_MONTH_NAMES = [
   'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
   'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

/** ارقام لاتین → فارسی، فقط برای نمایش */
const to_persian_digits = (value: string | number): string =>
   String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

/**
 * تاریخ شمسیِ رشته‌ای → شکل خوانا: «۱۴۰۵/۰۷/۲۸» ← «۲۸ مهر ۱۴۰۵»
 *
 * ⚠️ چرا این تابع اینجاست و از `jalali_date_words` در lib استفاده
 * نمی‌کنیم؟ چون آن یکی ورودی `Date` می‌گیرد و برای تبدیلِ رشته‌ی شمسی
 * باید اول به میلادی و بعد دوباره به شمسی برگردانده شود — یعنی دو بار
 * عبور از منطقه‌ی زمانی، دقیقاً همان‌جایی که تاریخ‌ها یک روز جابه‌جا
 * می‌شوند. اینجا هیچ `Date` ای ساخته نمی‌شود: رشته‌ی شمسی مستقیم به
 * رشته‌ی شمسی تبدیل می‌شود، پس هیچ‌وقت جابه‌جا نمی‌شود.
 *
 * ورودی ناقص (کاربر هنوز در حال تایپ) → رشته‌ی خالی، تا زیر فیلد چیزی
 * نیمه‌کاره ننویسد.
 */
export const jalaliToWords = (jalaliDate?: string | null): string => {
   if (!isCompleteJalaliDate(jalaliDate)) return '';
   const [jy, jm, jd] = toLatinDigitsKeepSlash(String(jalaliDate)).split('/').map(Number);
   const month = JALALI_MONTH_NAMES[jm - 1];
   if (!month) return '';
   return `${to_persian_digits(jd)} ${month} ${to_persian_digits(jy)}`;
};

/**
 * فاصله‌ی دو تاریخ شمسی به روز — **علامت‌دار**.
 *
 * ⚠️ عمداً `Math.abs` ندارد. اگر سررسید *قبل* از مبدا باشد (فاکتور
 * معوق در حالتی که مبدا را روی امروز گذاشته‌اید)، نتیجه باید منفی
 * باشد: آن فاکتور دیگر سررسید شده و باید روز راس را *کم* کند، نه
 * زیاد. قدرمطلق‌گرفتن، بدهیِ گذشته را به اعتبارِ آینده تبدیل می‌کند و
 * بهره را اشتباهاً بالا می‌برد.
 */
export const diffJalaliDays = (from?: string | null, to?: string | null): number | null => {
   const a = jalaliToDayNumber(from);
   const b = jalaliToDayNumber(to);
   if (a === null || b === null) return null;
   return b - a;
};

/** قدیمی‌ترین تاریخ از میان چند تاریخ شمسی (ناقص‌ها نادیده گرفته می‌شوند) */
export const earliestJalali = (dates: (string | null | undefined)[]): string => {
   const nums = dates.map(jalaliToDayNumber).filter((n): n is number => n !== null);
   if (nums.length === 0) return '';
   return dayNumberToJalali(Math.min(...nums));
};


const convertThreeDigits = (n: number): string => {
   if (n === 0) return '';

   if (n < 10) return ones[n];
   if (n < 20) return teens[n - 10];
   if (n < 100) {
      const ten = Math.floor(n / 10);
      const one = n % 10;
      return tens[ten] + (one ? ' و ' + ones[one] : '');
   }

   const hundred = Math.floor(n / 100);
   const rest = n % 100;
   return hundreds[hundred] + (rest ? ' و ' + convertThreeDigits(rest) : '');
};

export const numberToPersianWords = (num: number): string => {
   if (num === 0) return 'صفر';
   if (!num) return '';

   const numStr = num.toString();
   const chunks = [];

   // Create chunks of 3 digits
   for (let i = numStr.length; i > 0; i -= 3) {
      chunks.push(numStr.substring(Math.max(0, i - 3), i));
   }

   const words = chunks.map((chunk, index) => {
      const n = parseInt(chunk);
      if (n === 0) return '';
      const chunkWords = convertThreeDigits(n);
      const suffix = thousands[index];
      return chunkWords + (suffix ? ' ' + suffix : '');
   }).reverse().filter(w => w !== '').join(' و ');

   return words;
};

export const formatAmountToLetters = (rials: number): string => {
   if (!rials) return '';
   const toman = Math.floor(rials / 10);
   return numberToPersianWords(toman) + ' تومان';
};

export const formatToman = (num: number): string => {
   if (!num) return '';
   const toman = Math.floor(num / 10);
   return new Intl.NumberFormat('fa-IR').format(toman) + ' تومان';
};



/**
 * ورودیِ عددیِ کاربر را برای پردازش آماده می‌کند، بدون حذف بقیه‌ی کاراکترها:
 * - ارقام فارسی (۰-۹) و عربی (٠-٩) → ارقام انگلیسی
 * - ممیز فارسی «٫» (و در حالت decimal، اسلش «/» که خیلی‌ها به‌جای ممیز می‌زنند) → «.»
 * - جداکننده‌ی هزارگان (, ٬ ،) و فاصله حذف می‌شود
 *
 * ⚠️ بدون این، روی کیبورد فارسی (دسکتاپ یا گوشی) فیلدهای عددی هیچ رقمی قبول
 * نمی‌کردند و عدد قبلی سر جایش می‌ماند.
 */
export const normalizeNumberInput = (str: string, opts?: { decimal?: boolean }): string => {
   let out = str
      .replace(/[۰-۹]/g, ch => (ch.charCodeAt(0) - 1776).toString())
      .replace(/[٠-٩]/g, ch => (ch.charCodeAt(0) - 1632).toString())
      .replace(/٫/g, '.')
      .replace(/[,٬،\s]/g, '');
   if (opts?.decimal) out = out.replace(/\//g, '.');
   return out;
};

export const toEnglishDigits = (str: string | number | undefined | null): string => {
   if (!str) return '';
   return str
      .toString()
      .replace(/[۰-۹]/g, ch => (ch.charCodeAt(0) - 1776).toString())
      .replace(/[٠-٩]/g, ch => (ch.charCodeAt(0) - 1632).toString())
      .replace(/[^0-9]/g, ''); // Remove anything except numbers
};

/**
 * تاریخ شمسی (با ارقام فارسی).
 *
 * timeZone صریحاً روی تهران تنظیم شده است. بدون آن، مبنا تایم‌زون دستگاه بود:
 * روی سرور UTC یا برای کاربری خارج از ایران، تاریخ یک روز جابه‌جا می‌شد — و
 * چون تمام محاسبه‌ی راس روزشمار است، همان یک روز مبلغ چک‌ها را عوض می‌کرد.
 */
export const getTodayJalali = (isoDate?: string): string => {
   const date = isoDate ? new Date(isoDate) : new Date();
   if (isNaN(date.getTime())) return '';
   return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
   }).format(date);
};


export const BANKS_LIST = [
   'ملی', 'ملت', 'تجارت', 'سپه', 'کشاورزی', 'مسکن',
   'صنعت و معدن', 'توسعه تعاون', 'پست بانک', 'اقتصاد نوین', 'پارسیان',
   'کارآفرین', 'سامان', 'سینا', 'خاورمیانه', 'شهر', 'دی', 'صادرات',
   'رفاه', 'گردشگری', 'ایران زمین', 'سرمایه', 'پاسارگاد', 'رسالت', 'مهر ایران'
];