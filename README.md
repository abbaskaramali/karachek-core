# karachek-core

منطق مشترک کاراچک که بین سایت (`karachek`) و نسخه‌های نصبی (`karachek-windows` و بعداً اندروید/آیفون/مک) یکسان است.
هر باگ محاسبه فقط یک بار، همین‌جا، اصلاح می‌شود.

## محتوا

| مسیر | چیست | منبع اصلی در سایت |
|---|---|---|
| `src/utils.ts` | تاریخ شمسی، اعداد فارسی، فهرست بانک‌ها | `src/utils/utils.ts` |
| `src/installment/` | ماشین‌حساب اقساط | `src/utils/installment-calculator.ts`، `src/types/t_installment_v2.ts` |
| `src/raas/` | راس‌گیری و تطبیق تسویه | `src/lib/raas-calc.ts`، `src/lib/raas-match.ts` |
| `src/sync/` | قرارداد همگام‌سازی (نوع رکوردها، push/pull، ثبت دستگاه، مجوز آفلاین) | — (جدید) |

## استفاده

```bash
npm install github:abbaskaramali/karachek-core#v0.1.0
```

```ts
import { calculateInstallment, raas_average_days_exact, new_record_id } from '@karachek/core';
```

هنگام نصب از گیت، npm خودش `prepare` (یعنی `tsup`) را اجرا می‌کند و `dist/` ساخته می‌شود.
هر نسخه با تگ گیت (`v0.1.0`، `v0.2.0`، ...) منتشر شود و مصرف‌کننده‌ها به تگ پین شوند، نه به شاخه.

## قواعد

- **فقط کد خالص:** بدون mongoose، Next.js، Electron، DOM یا دسترسی به فایل/شبکه. هر چیزی که اینجا است باید روی سرور، Electron و موبایل اجرا شود.
- **تا وقتی سایت به این پکیج منتقل نشده**، فایل‌های این ریپو کپی همان فایل‌های سایت‌اند؛ هر اصلاح محاسبه در هر دو جا انجام شود. گام بعدی: سایت این پکیج را import کند و کپی‌های خودش را حذف کند.
- **شناسه‌ی رکوردها** قالب ObjectId دارد (`new_record_id`) تا سرور MongoDB بتواند رکورد ساخته‌شده روی دستگاه را با همان `_id` ذخیره کند.

## دستورات

```bash
npm test          # vitest
npm run typecheck
npm run build     # dist/ (ESM + CJS + d.ts)
```
