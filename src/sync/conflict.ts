import type { SyncMeta } from './protocol';

/**
 * «آخرین تغییر برنده» — داده‌ها مال یک کاربرند و تعارض نادر است.
 *
 * ⚠️ در تساوی کامل زمان، نسخه‌ی سرور برنده است: سرور مرجع اصلی است و
 * نتیجه باید روی همه‌ی دستگاه‌ها یکسان باشد (اگر هر طرف خودش را برنده
 * می‌دانست، دو دستگاه برای همیشه دو نسخه‌ی متفاوت نگه می‌داشتند).
 */
export const resolve_conflict = <T extends SyncMeta>(server: T | null | undefined, incoming: T): 'incoming' | 'server' => {
   if (!server) return 'incoming';
   const s = Date.parse(server.updated_at);
   const i = Date.parse(incoming.updated_at);
   if (!Number.isFinite(i)) return 'server';
   if (!Number.isFinite(s)) return 'incoming';
   return i > s ? 'incoming' : 'server';
};
