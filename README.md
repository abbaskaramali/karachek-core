# karachek-core

منطق مشترک **نسخه‌های نصبی** کاراچک (`karachek-windows` و بعداً اندروید/آیفون/مک).
هر باگ محاسبه در نسخه‌های نصبی فقط یک بار، همین‌جا، اصلاح می‌شود.

> ⚠️ سایت (`karachek`) به این پکیج وابسته **نیست** و نخواهد شد: سایت و نسخه‌های نصبی مستقل تغییر می‌کنند
> تا هیچ تغییری اینجا روی سایت اثر نگذارد. محتوای اولیه از سایت کپی شده است.

## محتوا

| مسیر | چیست | منبع اصلی در سایت |
|---|---|---|
| `src/utils.ts` | تاریخ شمسی، اعداد فارسی، فهرست بانک‌ها | `src/utils/utils.ts` |
| `src/installment/` | ماشین‌حساب اقساط | `src/utils/installment-calculator.ts`، `src/types/t_installment_v2.ts` |
| `src/raas/` | راس‌گیری و تطبیق تسویه | `src/lib/raas-calc.ts`، `src/lib/raas-match.ts` |
| `src/sync/` | قرارداد همگام‌سازی (نوع رکوردها، push/pull، ثبت دستگاه، مجوز آفلاین) | — (جدید) |

## استفاده

```bash
npm install github:abbaskaramali/karachek-core#main
```

```ts
import { calculateInstallment, raas_average_days_exact, new_record_id } from '@karachek/core';
```

هنگام نصب از گیت، npm خودش `prepare` (یعنی `tsup`) را اجرا می‌کند و `dist/` ساخته می‌شود.
`package-lock.json` مصرف‌کننده کامیت دقیق را قفل می‌کند؛ برای گرفتن نسخه‌ی جدید `npm update @karachek/core` اجرا شود.

## قواعد

- **فقط کد خالص:** بدون mongoose، Next.js، Electron، DOM یا دسترسی به فایل/شبکه. هر چیزی که اینجا است باید روی سرور، Electron و موبایل اجرا شود.
- فایل‌های محاسبه کپی همان فایل‌های سایت‌اند. اگر فرمولی در سایت اصلاح شد و باید در نسخه‌های نصبی هم باشد، اینجا هم اعمال شود (دستی، آگاهانه).
- **شناسه‌ی رکوردها** قالب ObjectId دارد (`new_record_id`) تا سرور MongoDB بتواند رکورد ساخته‌شده روی دستگاه را با همان `_id` ذخیره کند.

## دستورات

```bash
npm test          # vitest
npm run typecheck
npm run build     # dist/ (ESM + CJS + d.ts)
```
