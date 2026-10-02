/**
 * شناسه‌ی رکوردی که روی دستگاه (حتی آفلاین) ساخته می‌شود.
 *
 * ⚠️ چرا ObjectId و نه UUID؟ سرور MongoDB است و همه‌ی رکوردهای فعلی
 * `_id` از نوع ObjectId دارند. اگر دستگاه شناسه‌ای با همان قالب
 * (۲۴ رقم هگز: ۴ بایت زمان + ۸ بایت تصادفی) بسازد، سرور می‌تواند
 * همان را مستقیم به‌عنوان `_id` ذخیره کند — بدون ستون نگاشت اضافه و
 * بدون اینکه سایت فعلی چیزی بفهمد. ۸ بایت تصادفی برای یکتایی کافی است.
 */
const hex = (bytes: Uint8Array): string =>
   Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const new_record_id = (now: number = Date.now()): string => {
   const seconds = Math.floor(now / 1000);
   const random = new Uint8Array(8);
   globalThis.crypto.getRandomValues(random);
   return seconds.toString(16).padStart(8, '0') + hex(random);
};

export const is_record_id = (value: unknown): value is string =>
   typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
