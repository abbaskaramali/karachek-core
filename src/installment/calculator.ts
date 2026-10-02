import { 
   InstallmentCalculationInput, 
   InstallmentCalculationResult, 
   InstallmentScheduleItem,
   RoundingStrategy,
   InterestType
} from './types';

/**
 * سقف سراسری تعداد قسط/چک در یک محاسبه.
 *
 * چرا لازم است: در حالت «مبلغ قسط معلوم»، فرمولِ سود ساده و اصل ثابت
 *    n = اصل ÷ (قسط − اصل×نرخ)
 * است. اگر کاربر مبلغی *کمی* بالاتر از کف وارد کند (مثلا ۱ ریال بالاتر)،
 * مخرج به ۱ می‌رسد و n برابر کل مبلغ وام می‌شود — یعنی صدها میلیون ردیف.
 * قبلاً همین باعث می‌شد پروسه‌ی سرور با خطای out-of-memory بمیرد.
 * این سقف جلوی آن را می‌گیرد و به‌جای کرش، پیام فارسی قابل فهم می‌دهد.
 */
export const MAX_INSTALLMENT_COUNT = 360;

/**
 * محاسبه اقساط با تمام حالت‌ها و روش‌های رُند کردن
 */
export function calculateInstallment(input: InstallmentCalculationInput): InstallmentCalculationResult {
   const principal = input.total_loan - input.prepayment;
   const rateDecimal = input.monthly_rate / 100;
   
   // ولیدیشن اولیه
   if (principal <= 0) {
      return createInvalidResult('مبلغ اصل وام باید مثبت باشد');
   }
   
   if (input.monthly_rate < 0) {
      return createInvalidResult('نرخ بهره نمی‌تواند منفی باشد');
   }
   
   let result: InstallmentCalculationResult;
   
   // تاریخ شمسی امروز — همیشه بر مبنای وقت رسمی ایران، نه ساعت سرور.
   // (اگر سرور روی UTC باشد، بین ۲۰:۳۰ تا ۲۴:۰۰ به وقت تهران یک روز عقب می‌افتد و
   //  چون کل محاسبه‌ی «بازاری» روزشمار است، همان یک روز مبلغ چک‌ها را جابه‌جا می‌کند.)
   const dayRounding: DayRounding = input.day_rounding || 'NONE';
   const startDate = input.start_date || getTodayJalaliTehran();
   // todayDate: اگر start_date سفارشی داده شده، امروز رو هم برای محاسبه روز واقعی نگه دار
   const todayDate = input.start_date ? (input.today_date || getTodayJalaliTehran()) : undefined;
   const interval = input.check_interval_months ?? 1;
   const isMarket = input.interest_type === 'MARKET';

   switch (input.mode) {
      case 'COUNT':
         if (isMarket) {
            // در حالت بازاری برای COUNT ماهانه، interval=1
            result = calculateMarketByCount(principal, input.monthly_rate, input.count!, 1, input.rounding_strategy, startDate, todayDate, dayRounding);
         } else {
            result = calculateByCount(principal, rateDecimal, input.count!, input.prepayment, input.interest_type, input.rounding_strategy, startDate, todayDate, dayRounding);
         }
         break;
      case 'AMOUNT':
         if (isMarket) {
            result = calculateMarketByAmount(principal, input.monthly_rate, input.target_payment!, 1, input.rounding_strategy, startDate, todayDate, dayRounding);
         } else {
            result = calculateByAmount(principal, rateDecimal, input.target_payment!, input.prepayment, input.interest_type, input.rounding_strategy, startDate, todayDate, dayRounding);
         }
         break;
      case 'CHECK_COUNT':
         if (isMarket) {
            // input.count = تعداد چک (نه ماه) — قبلاً در UI تقسیم شده
            const checkCount = input.count!;
            result = calculateMarketByCount(principal, input.monthly_rate, checkCount, interval, input.rounding_strategy, startDate, todayDate, dayRounding);
         } else {
            result = calculateByCheckCount(principal, rateDecimal, input.count!, input.check_interval_months!, input.prepayment, input.interest_type, input.rounding_strategy, startDate, todayDate, dayRounding);
         }
         break;
      case 'CHECK_AMOUNT':
         if (isMarket) {
            // target_payment = حداکثر قسط ماهانه → هر چک = target × interval ماه
            const targetCheckAmt = input.target_payment! * interval;
            result = calculateMarketByAmount(principal, input.monthly_rate, targetCheckAmt, interval, input.rounding_strategy, startDate, todayDate, dayRounding);
         } else {
            result = calculateByCheckAmount(principal, rateDecimal, input.target_payment!, input.check_interval_months!, input.prepayment, input.interest_type, input.rounding_strategy, startDate, todayDate, dayRounding);
         }
         break;
      default:
         return createInvalidResult('نوع محاسبه نامعتبر است');
   }
   
   // چک محدودیت ماه
   if (input.max_months && result.is_valid && result.total_months > input.max_months) {
      result.warning_message = `توجه: ${result.total_months} ماه زمان نیاز است، اما حداکثر ${input.max_months} ماه مجاز است.`;
   }

   // ─── نرخ سود «مؤثر» واقعی این جدول ───
   // نرخ اسمی (monthly_rate) بین روش‌ها قابل مقایسه نیست: مثلاً «سود ساده بدون راس»
   // با نرخ اسمی ۵٪ عملاً حدود ۸٪ در ماه تمام می‌شود، چون سود را روی مبلغی می‌گیرد
   // که مشتری دیگر بدهکارش نیست. عدد زیر (IRR) تنها معیار منصفانه‌ی مقایسه است.
   if (result.is_valid && result.installments.length > 0) {
      // واحد زمان باید «ماه واقعی» باشد، نه شماره‌ی ردیف. اگر کاربر تاریخ چک
      // اول را طوری بگذارد که فاصله‌ی اولین دوره یک ماه کامل نباشد (مثلا ۱۵ روز
      // بعد)، سود یک دوره‌ی کامل روی نصف زمان گرفته می‌شود و نرخ مؤثر واقعا
      // بالاتر است. با شماره‌ی ردیف، این واقعیت دیده نمی‌شد.
      const dayRef = todayDate || startDate;
      const irrItems = result.installments.map(inst => {
         const m = jalaliMonthsBetween(dayRef, inst.due_date);
         return m === null ? inst : { ...inst, month: m };
      });
      result.effective_monthly_rate = computeEffectiveMonthlyRate(principal, irrItems);

      // ─── هشدار «تاریخ چک اول، سود شما را آب کرد» ───
      // در روش‌های سود ساده / اصل ثابت / قسط ثابت بانکی، عقب انداختن چک اول
      // مبلغ هیچ قسطی را عوض نمی‌کند — یعنی مشتری آن مدت را رایگان اعتبار
      // می‌گیرد و فروشنده چون عدد قسط تغییر نکرده، متوجه نمی‌شود.
      const eff = result.effective_monthly_rate;
      if (
         input.start_date &&
         input.monthly_rate > 0 &&
         eff !== undefined &&
         eff < (input.monthly_rate / 100) * 0.9
      ) {
         const effPct = Math.round(eff * 1000) / 10;
         result.warning_message = [
            result.warning_message,
            `⚠ با این «تاریخ چک اول»، نرخ سود مؤثر واقعی این جدول حدود ${effPct.toLocaleString('fa-IR')}٪ در ماه است، ` +
            `نه ${input.monthly_rate.toLocaleString('fa-IR')}٪. یعنی فاصله‌ی تا اولین چک عملاً بدون سود حساب شده است. ` +
            `اگر می‌خواهید نرخ واقعی حفظ شود، نرخ را بالاتر ببرید یا از روش «بازاری» استفاده کنید.`,
         ].filter(Boolean).join('\n');
      }
   }

   // ─── گاردهای ایمنی گردکردن ───
   // گردکردن یک لایه‌ی «آرایشی» روی جدول است، ولی وقتی گام گردکردن نسبت به
   // مبلغ قسط بزرگ باشد، می‌تواند سود را چند برابر کند یا حتی فروشنده را
   // به ضرر بیندازد. این حالت‌ها قبلاً بی‌صدا رد می‌شدند.
   if (result.is_valid && result.installments.length > 0) {
      addRoundingWarnings(result, principal, input.rounding_strategy);
   }

   return result;
}

/** گام گردکردن هر استراتژی بر حسب ریال (۰ یعنی گردکردن مقداری ندارد) */
export function roundingStepRial(strategy: RoundingStrategy): number {
   switch (strategy) {
      case 'ROUND_UP_1K': case 'ROUND_DOWN_1K': return 10000;
      case 'ROUND_UP_5K': case 'ROUND_DOWN_5K': return 50000;
      case 'ROUND_UP_10K': case 'ROUND_DOWN_10K': return 100000;
      case 'ROUND_UP_50K': case 'ROUND_DOWN_50K': return 500000;
      case 'ROUND_UP_100K': case 'ROUND_DOWN_100K': return 1000000;
      case 'FIRST_INSTALLMENT': case 'LAST_INSTALLMENT': return 10000;
      default: return 0;
   }
}

/**
 * سه خطر گردکردن که قبلاً هیچ هشداری نداشتند:
 *
 * ۱) جمع اقساط از اصل وام کمتر شود  → فروشنده ضرر می‌کند (سود منفی).
 * ۲) گام گردکردن نسبت به مبلغ قسط بزرگ باشد → سود چند برابر می‌شود.
 * ۳) مبلغ یکی از اقساط صفر شود → ردیف بی‌معنی در جدول.
 *
 * این تابع فقط «هشدار» اضافه می‌کند و هیچ عددی را عوض نمی‌کند، پس روی
 * محاسبات موجود (از جمله روش‌های بازاری) هیچ اثری ندارد.
 */
function addRoundingWarnings(
   result: InstallmentCalculationResult,
   principal: number,
   strategy: RoundingStrategy,
): void {
   const warnings: string[] = [];
   const step = roundingStepRial(strategy);

   const zeroRows = result.installments.filter(i => i.payment <= 0).length;
   if (zeroRows > 0) {
      warnings.push(
         `با این روش گردکردن، مبلغ ${zeroRows.toLocaleString('fa-IR')} قسط صفر شده است. ` +
         `گام گردکردن را کوچک‌تر کنید یا روش «دقیق» را انتخاب کنید.`
      );
   }

   if (result.total_payment < principal) {
      const loss = principal - result.total_payment;
      warnings.push(
         `⚠ توجه: با این روش گردکردن، جمع اقساط ${Math.round(loss / 10).toLocaleString('fa-IR')} تومان ` +
         `کمتر از اصل مبلغ می‌شود؛ یعنی نه‌تنها سودی نمی‌گیرید، بلکه ضرر می‌کنید.`
      );
   } else if (step > 0 && result.installments.length > 0) {
      const smallest = Math.min(...result.installments.map(i => i.payment).filter(p => p > 0));
      if (isFinite(smallest) && smallest > 0 && step / smallest > 0.05) {
         const pct = Math.round((step / smallest) * 100);
         warnings.push(
            `⚠ گام گردکردن (${Math.round(step / 10).toLocaleString('fa-IR')} تومان) حدود ${pct.toLocaleString('fa-IR')}٪ ` +
            `مبلغ قسط است و می‌تواند سود واقعی را به‌شدت جابه‌جا کند. ` +
            `گام کوچک‌تری انتخاب کنید یا نتیجه را با روش «دقیق» مقایسه کنید.`
         );
      }
   }

   if (warnings.length > 0) {
      result.warning_message = [result.warning_message, ...warnings].filter(Boolean).join('\n');
   }
}

/**
 * فاصله‌ی دو تاریخ شمسی بر حسب «ماه واقعی» (اعشاری).
 *
 * چرا لازم است: ماه‌های شمسی ۲۹ تا ۳۱ روزند و کاربر هم می‌تواند تاریخ چک اول
 * را روی هر روزی بگذارد. اگر فاصله را بر عدد ثابت ۳۰ تقسیم کنیم، یک جدول
 * کاملا منظم ۶ ماهه، ۶.۲ ماه به نظر می‌رسد و نرخ مؤثر کمتر از واقعیت
 * نمایش داده می‌شود.
 *
 * برای سررسیدهای منظم، عدد صحیح برمی‌گرداند؛ فقط وقتی فاصله‌ها نامنظم باشد
 * (مثلا چک اول ۱۵ روز بعد بسته شده) مقدار اعشاری می‌دهد.
 */
export function jalaliMonthsBetween(from?: string, to?: string): number | null {
   if (!from || !to) return null;
   const a = from.split('/').map(Number);
   const b = to.split('/').map(Number);
   if (a.length !== 3 || b.length !== 3 || a.some(isNaN) || b.some(isNaN)) return null;
   const lenOf = (y: number, m: number) => (m <= 6 ? 31 : m <= 11 ? 30 : (isJalaliLeapYear(y) ? 30 : 29));
   let months = (b[0] - a[0]) * 12 + (b[1] - a[1]);
   let frac: number;
   if (b[2] >= a[2]) {
      frac = (b[2] - a[2]) / lenOf(b[0], b[1]);
   } else {
      months -= 1;
      let py = b[0], pm = b[1] - 1;
      if (pm < 1) { pm = 12; py -= 1; }
      const plen = lenOf(py, pm);
      frac = (b[2] + plen - a[2]) / plen;
   }
   const total = months + frac;
   return total > 0 ? total : null;
}

/**
 * نرخ بازده داخلی (IRR) ماهانه‌ی واقعیِ یک جدول اقساط.
 * خروجی: عدد اعشاری (مثلاً 0.0582 یعنی ۵.۸۲٪ در ماه) یا undefined اگر قابل محاسبه نباشد.
 */
export function computeEffectiveMonthlyRate(
   principal: number,
   installments: InstallmentScheduleItem[]
): number | undefined {
   if (principal <= 0 || installments.length === 0) return undefined;

   // واحد زمان: «ماه» به همان معنایی که کاربر نرخ را وارد کرده است (شماره‌ی دوره‌ی هر چک).
   // با این تعریف، روش‌های «اصل ثابت» و «قسط ثابت — روش بانکی» دقیقاً همان نرخ واردشده را برمی‌گردانند
   // و هر انحراف از آن، یعنی آن روش واقعاً بیشتر (یا کمتر) از نرخ اعلامی سود می‌گیرد.
   const periods: { t: number; amt: number }[] = [];
   for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      const months = inst.month || i + 1;
      if (inst.payment > 0) periods.push({ t: months, amt: inst.payment });
   }
   if (periods.length === 0) return undefined;

   const npv = (r: number) =>
      -principal + periods.reduce((s, c) => s + c.amt / Math.pow(1 + r, c.t), 0);

   if (npv(0) <= 0) return 0;   // اصلاً سودی در کار نیست
   let lo = 0, hi = 5;          // تا ۵۰۰٪ در ماه
   if (npv(hi) > 0) return undefined;
   for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
   }
   return (lo + hi) / 2;
}

/**
 * حالت 1: تعداد قسط معلوم → مبلغ قسط محاسبه
 */
function calculateByCount(
   principal: number,
   rateDecimal: number,
   count: number,
   prepayment: number,
   interestType: InterestType,
   rounding: RoundingStrategy,
   startDate?: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {
   if (principal <= 0 || count <= 0) {
      return createInvalidResult('مبلغ اصل یا تعداد اقساط نامعتبر است');
   }
   // گارد نهایی: هیچ مسیری نباید بتواند جدولی بزرگ‌تر از سقف بسازد.
   if (!isFinite(count) || count > MAX_INSTALLMENT_COUNT) {
      return createInvalidResult(
         `تعداد اقساط (${Math.round(count).toLocaleString('fa-IR')}) از حد مجاز ${MAX_INSTALLMENT_COUNT.toLocaleString('fa-IR')} قسط بیشتر است. ` +
         `مبلغ قسط را بالاتر ببرید یا تعداد اقساط را کم کنید.`
      );
   }
   
   let monthlyPayment: number;
   let installments: InstallmentScheduleItem[];
   let exactTotalInterest: number = 0;  // برای حفظ سود دقیق
   
   if (interestType === 'SIMPLE') {
      // سود ساده بدون راس (Flat / Add-on): سود کل روی مانده اولیه و برای کل مدت
      // یک‌جا محاسبه می‌شود؛ برخلاف روش «بازاری/MARKET»، به تاریخ دقیق سررسید
      // حساس نیست و فقط تعداد ماه/دوره برایش مهم است.
      const totalInterest = principal * rateDecimal * count;
      exactTotalInterest = totalInterest;  // ذخیره سود دقیق
      const totalAmount = principal + totalInterest;
      monthlyPayment = totalAmount / count;
      
      // برای سود ساده، اقساط یکسان هستند
      installments = [];
      for (let i = 0; i < count; i++) {
         installments.push({
            month: i + 1,
            payment: Math.round(monthlyPayment),
            principal: Math.round(principal / count),
            interest: Math.round(totalInterest / count),
            remaining: Math.round(principal - (principal / count) * (i + 1))
         });
      }
   } else if (interestType === 'FIXED_PRINCIPAL') {
      // اصل ثابت: هر دوره سهم اصل ثابت است (principal/count)، سود آن دوره روی
      // مانده‌ی واقعیِ باقی‌مانده حساب می‌شود — پس اقساط نزولی‌اند.
      const fixedPrincipalPerCheck = principal / count;
      let balance = principal;
      installments = [];
      let runningInterest = 0;
      for (let i = 0; i < count; i++) {
         const interest = balance * rateDecimal;
         runningInterest += interest;
         installments.push({
            month: i + 1,
            payment: Math.round(fixedPrincipalPerCheck + interest),
            principal: Math.round(fixedPrincipalPerCheck),
            interest: Math.round(interest),
            remaining: Math.round(balance - fixedPrincipalPerCheck)
         });
         balance -= fixedPrincipalPerCheck;
      }
      exactTotalInterest = runningInterest;
      monthlyPayment = installments[0]?.payment ?? 0;  // قسط اول (بزرگ‌ترین) به‌عنوان نماینده
   } else if (interestType === 'AVERAGE_BALANCE') {
      // بازاری — کسر از پایین: نگاه دومِ همان «بازاری»، از زاویه‌ی مشتری.
      // به‌جای فرمول نمادین (n+1)/2 بر مبنای ماه، از میانگین روزِ راسِ *واقعی*
      // (دقیقاً همان مبنایی که در MARKET/راس‌گیری استفاده می‌شود) استفاده می‌کنیم؛
      // پس این روش هم به تاریخ چک اول و به تاریخ/مبلغ هر چک حساس است.
      const dailyRate = rateDecimal / 30;
      const daysArr: number[] = [];
      for (let i = 1; i <= count; i++) {
         const { days } = addMonthsJalali(startDate || '', i, todayDate);
         daysArr.push(days);
      }
      const avgDay = roundAvgDay(daysArr.reduce((s, d) => s + d, 0) / count, dayRounding);
      const totalInterest = dailyRate * avgDay * principal;
      exactTotalInterest = totalInterest;
      const totalAmount = principal + totalInterest;
      monthlyPayment = totalAmount / count;
      // ─── تفکیک اصل/سود بر مبنای «پول × زمان» ───
      // سود کل این روش از راسِ وزن‌دار (مبلغ × روز) به‌دست می‌آید، پس سهم هر چک از
      // سود هم باید به همان نسبت باشد: (مبلغ چک × روزِ آن) ÷ مجموع همین حاصل‌ضرب‌ها.
      //
      // قبلاً سود به‌طور مساوی بین چک‌ها تقسیم می‌شد. دو ایراد داشت:
      //   ۱) چکِ ۱۲۲ روزه و چکِ ۲۴۲ روزه سود یکسان نشان می‌دادند، که با مبنای
      //      خودِ روش (راس = پول × زمان) نمی‌خواند.
      //   ۲) ستون «اصل» عددِ ثابتِ اصل÷n بود؛ به‌محض اینکه مبلغ یک چک از این سهم
      //      کمتر شود (ویرایش دستی کاربر)، ستون سود منفی می‌شد — عددی که از نظر
      //      مالی بی‌معنی است.
      // این تخصیص همیشه نامنفی است و جمع ستون‌ها دقیقاً برابر اصل و سود کل می‌ماند.
      const payPerCheckAB = Math.round(monthlyPayment);
      const dayWeightSumAB = daysArr.reduce((s, d) => s + d, 0);
      installments = [];
      let allocatedPrincipalAB = 0;
      for (let i = 0; i < count; i++) {
         const share = dayWeightSumAB > 0 ? daysArr[i] / dayWeightSumAB : 1 / count;
         const interest_i = totalInterest * share;
         const principal_i = payPerCheckAB - interest_i;
         allocatedPrincipalAB += principal_i;
         installments.push({
            month: i + 1,
            payment: payPerCheckAB,
            principal: Math.round(principal_i),
            interest: Math.round(interest_i),
            remaining: Math.max(0, Math.round(principal - allocatedPrincipalAB))
         });
      }
   } else {
      // قسط ثابت — روش بانکی (آنیوئیتی)
      if (rateDecimal === 0) {
         monthlyPayment = principal / count;
      } else {
         const x = Math.pow(1 + rateDecimal, count);
         monthlyPayment = (principal * rateDecimal * x) / (x - 1);
      }
      
      // محاسبه جدول اقساط
      installments = buildInstallmentSchedule(principal, rateDecimal, monthlyPayment, count);
   }
   
   // اعمال رُند
   const roundedInstallments = applyRounding(installments, principal, rounding);
   
   // اضافه کردن تاریخ سررسید
   if (startDate) {
      addDueDates(roundedInstallments, startDate);
   }
   
   // محاسبه totalPayment و totalInterest
   // نکته مهم: total_payment اینجا فقط «جمع مبالغی که از طریق اقساط پرداخت می‌شود»ست
   // (هماهنگ با calculateMarketByCount) — پیش‌پرداخت را عمداً اینجا اضافه نمی‌کنیم؛
   // جمع‌بستن با پیش‌پرداخت وظیفه‌ی لایه‌ی بالاتر (route/UI) است، وگرنه دوبار حساب می‌شود.
   // «جمع کل» همیشه باید دقیقاً جمع همان چک‌هایی باشد که در جدول چاپ می‌شود.
   // قبلاً برای سود ساده/اصل ثابت/کسر از پایین، عددِ *پیش از گردکردن* گزارش می‌شد و
   // با جمع ردیف‌های جدول نمی‌خواند (تا صدها هزار تومان اختلاف در گردکردن‌های درشت).
   const totalPayment = roundedInstallments.reduce((sum, inst) => sum + inst.payment, 0);
   const totalInterest = totalPayment - principal;

   return {
      monthly_payment: monthlyPayment,
      total_months: count,
      total_payment: totalPayment,
      total_interest: totalInterest,
      exact_total_interest: exactTotalInterest > 0 ? exactTotalInterest : undefined,
      installments: roundedInstallments,
      is_valid: true
   };
}

/**
 * حالت 2: مبلغ قسط معلوم → تعداد قسط محاسبه
 */
function calculateByAmount(
   principal: number,
   rateDecimal: number,
   targetPayment: number,
   prepayment: number,
   interestType: InterestType,
   rounding: RoundingStrategy,
   startDate?: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {
   // کف مبلغ قسط برای هر روش فرق دارد:
   // - سود ساده / اصل ثابت / مرکب: زیر «سود یک ماه» اصلاً اصل بدهی کم نمی‌شود → کف = P × نرخ
   // - کسر از پایین: چون سود روی *میانگین* روزها حساب می‌شود، کف نصف است → P × نرخ ÷ ۲
   const minPayment = interestType === 'AVERAGE_BALANCE'
      ? principal * rateDecimal / 2
      : principal * rateDecimal;

   if (targetPayment <= minPayment && rateDecimal > 0) {
      return createInvalidResult(
         interestType === 'AVERAGE_BALANCE'
            ? `مبلغ قسط باید بیشتر از ${Math.ceil(minPayment / 10).toLocaleString('fa-IR')} تومان باشد.\n` +
              `در روش «کسر از پایین»، هرچقدر هم تعداد قسط را زیاد کنید، قسط از این مبلغ پایین‌تر نمی‌آید.`
            : `مبلغ قسط باید بیشتر از ${Math.ceil(minPayment / 10).toLocaleString('fa-IR')} تومان باشد.\n` +
              `با مبلغ فعلی، فقط سود ماهانه پرداخت می‌شود و اصل کم نمی‌شود.`
      );
   }
   
   let count: number;
   
   if (interestType === 'SIMPLE' || interestType === 'FIXED_PRINCIPAL') {
      // سود ساده و اصل ثابت هر دو یک فرمول جستجو دارند: قسط اول/ثابت هر دو
      // برابر principal/n + principal×rate است (برای اصل ثابت، این بزرگ‌ترین قسط است)
      if (targetPayment <= minPayment && rateDecimal > 0) {
         return createInvalidResult('مبلغ قسط بسیار کم است');
      }
      count = rateDecimal === 0 
         ? Math.ceil(principal / targetPayment)
         : Math.ceil(principal / (targetPayment - principal * rateDecimal));
      // مبلغ قسط ممکن است فقط «کمی» بالاتر از کف باشد؛ در آن صورت n به میلیون‌ها
      // می‌رسد. به‌جای ساختن آن جدول (که حافظه‌ی سرور را تمام می‌کند)، خطا می‌دهیم.
      if (!isFinite(count) || count > MAX_INSTALLMENT_COUNT) {
         return createInvalidResult(
            tooManyInstallmentsMessage(principal, rateDecimal, MAX_INSTALLMENT_COUNT, 1, 'قسط')
         );
      }
   } else if (interestType === 'AVERAGE_BALANCE') {
      // بازاری — کسر از پایین: چون فرمولش بر مبنای میانگین روزِ راسِ واقعیِ
      // تقویم است (نه یک رابطه‌ی جبری ساده)، به‌جای حل بسته، تعداد قسط را با
      // جستجوی افزایشی پیدا می‌کنیم — دقیقاً تا جایی که قسط مساوی از هدف کمتر شود.
      const dailyRate = rateDecimal / 30;
      count = 1;
      let found = false;
      while (count <= MAX_INSTALLMENT_COUNT) {
         const daysArr: number[] = [];
         for (let i = 1; i <= count; i++) {
            const { days } = addMonthsJalali(startDate || '', i, todayDate);
            daysArr.push(days);
         }
         const avgDay = roundAvgDay(daysArr.reduce((s, d) => s + d, 0) / count, dayRounding);
         const totalInterest = dailyRate * avgDay * principal;
         const checkPayment = (principal + totalInterest) / count;
         if (checkPayment <= targetPayment) { found = true; break; }
         count++;
      }
      if (!found) {
         return createInvalidResult(
            `با این مبلغ قسط، تعداد اقساط از حد مجاز (${MAX_INSTALLMENT_COUNT.toLocaleString('fa-IR')} قسط) بیشتر می‌شود. مبلغ قسط را بالاتر ببرید.`
         );
      }
   } else {
      // قسط ثابت — روش بانکی
      if (rateDecimal === 0) {
         count = Math.ceil(principal / targetPayment);
      } else {
         count = Math.log(targetPayment / (targetPayment - principal * rateDecimal)) / Math.log(1 + rateDecimal);
         count = Math.ceil(count);
      }
      if (!isFinite(count) || count > MAX_INSTALLMENT_COUNT) {
         return createInvalidResult(
            tooManyInstallmentsMessage(principal, rateDecimal, MAX_INSTALLMENT_COUNT, 1, 'قسط')
         );
      }
   }
   
   // محاسبه دقیق با تعداد به دست آمده
   return calculateByCount(principal, rateDecimal, count, prepayment, interestType, rounding, startDate, todayDate, dayRounding);
}

/**
 * پیام خطای «تعداد اقساط از سقف گذشت» — به‌جای اینکه فقط بگوید «زیاد است»،
 * حداقلِ مبلغی را که با سقف مجاز جواب می‌دهد هم به کاربر می‌گوید تا مجبور
 * نشود کورکورانه عددها را بالا و پایین کند.
 */
function tooManyInstallmentsMessage(
   principal: number,
   rateDecimal: number,
   maxCount: number,
   intervalMonths: number,
   unit: 'قسط' | 'چک',
): string {
   // کف عملی برای رسیدن به maxCount قسط (سود ساده/اصل ثابت):
   //   قسط = اصل ÷ n + اصل × نرخ × فاصله
   const practicalMin = principal / maxCount + principal * rateDecimal * intervalMonths;
   const perMonth = practicalMin / intervalMonths;
   return (
      `با این مبلغ، تعداد ${unit}‌ها از حد مجاز (${maxCount.toLocaleString('fa-IR')} ${unit}) بیشتر می‌شود.\n` +
      `برای اینکه محاسبه در سقف مجاز جا شود، مبلغ ماهانه باید حداقل حدود ` +
      `${Math.ceil(perMonth / 10).toLocaleString('fa-IR')} تومان باشد.`
   );
}

/**
 * حالت 3: تعداد چک معلوم → مبلغ چک محاسبه
 */
function calculateByCheckCount(
   principal: number,
   rateDecimal: number,
   checkCount: number,
   intervalMonths: number,
   prepayment: number,
   interestType: InterestType,
   rounding: RoundingStrategy,
   startDate?: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {
   if (principal <= 0 || checkCount <= 0) {
      return createInvalidResult('مبلغ اصل یا تعداد چک‌ها نامعتبر است');
   }
   if (!isFinite(checkCount) || checkCount > MAX_INSTALLMENT_COUNT) {
      return createInvalidResult(
         `تعداد چک‌ها (${Math.round(checkCount).toLocaleString('fa-IR')}) از حد مجاز ${MAX_INSTALLMENT_COUNT.toLocaleString('fa-IR')} چک بیشتر است. ` +
         `مبلغ ماهانه را بالاتر ببرید یا تعداد چک‌ها را کم کنید.`
      );
   }

   const totalMonths = checkCount * intervalMonths;
   
   if (interestType === 'SIMPLE') {
      // سود ساده: محاسبه ساده و مستقیم
      const totalInterest = principal * rateDecimal * totalMonths;
      const totalAmount = principal + totalInterest;
      const checkPayment = totalAmount / checkCount;  // هر چک = کل مبلغ / تعداد چک
      
      // ساخت لیست چک‌ها
      const checkInstallments: InstallmentScheduleItem[] = [];
      for (let i = 0; i < checkCount; i++) {
         checkInstallments.push({
            month: (i + 1) * intervalMonths,
            payment: Math.round(checkPayment),
            principal: Math.round(principal / checkCount),
            interest: Math.round(totalInterest / checkCount),
            remaining: Math.round(principal - (principal / checkCount) * (i + 1))
         });
      }
      
      const roundedChecks = applyRoundingToChecks(checkInstallments, principal, rounding);
      
      if (startDate) {
         addDueDates(roundedChecks, startDate, intervalMonths);
      }
      
      // جمع کل = دقیقاً جمع همان چک‌هایی که چاپ می‌شود (بعد از گردکردن)
      const totalPayment = roundedChecks.reduce((sum, c) => sum + c.payment, 0);
      const finalInterest = totalPayment - principal;

      return {
         monthly_payment: checkPayment / intervalMonths,  // قسط ماهانه معادل
         total_months: totalMonths,
         total_payment: totalPayment,
         total_interest: finalInterest,
         exact_total_interest: totalInterest,
         check_count: checkCount,
         check_amount: checkPayment,
         check_interval_months: intervalMonths,
         installments: roundedChecks,
         is_valid: true
      };
   } else if (interestType === 'FIXED_PRINCIPAL') {
      // اصل ثابت: سهم اصل هر چک ثابت (principal/checkCount)، سود هر چک روی مانده واقعی
      //
      // نرخ هر دوره = (۱+نرخ ماهانه)^فاصله − ۱  (نه نرخ ماهانه × فاصله)
      // چرا: با ضرب ساده، چک دو ماهه نرخ ۱۰٪ می‌گرفت در حالی که دو ماهِ پشت‌سرهم
      // با نرخ ۵٪ برابر ۱۰.۲۵٪ است. نتیجه‌اش این بود که نرخ سود *مؤثر* جدول
      // ۴.۸۸٪ درمی‌آمد نه ۵٪ — یعنی کارت «نرخ مؤثر» عملاً به فروشنده دروغ می‌گفت
      // و «اصل ثابت» فقط در حالت ماهانه واقعاً نرخ اعلامی را می‌داد.
      // برای فاصله‌ی یک‌ماهه هر دو فرمول دقیقاً یک عدد می‌دهند، پس محاسبات ماهانه
      // اصلاً تغییر نمی‌کند.
      const fpPeriodRate = Math.pow(1 + rateDecimal, intervalMonths) - 1;
      const fixedPrincipalPerCheck = principal / checkCount;
      const checkInstallments: InstallmentScheduleItem[] = [];
      let balance = principal;
      let runningInterest = 0;
      for (let i = 0; i < checkCount; i++) {
         const interest = balance * fpPeriodRate;
         runningInterest += interest;
         checkInstallments.push({
            month: (i + 1) * intervalMonths,
            payment: Math.round(fixedPrincipalPerCheck + interest),
            principal: Math.round(fixedPrincipalPerCheck),
            interest: Math.round(interest),
            remaining: Math.round(balance - fixedPrincipalPerCheck)
         });
         balance -= fixedPrincipalPerCheck;
      }

      const roundedChecks = applyRoundingToChecks(checkInstallments, principal, rounding);

      if (startDate) {
         addDueDates(roundedChecks, startDate, intervalMonths);
      }

      const totalPayment = roundedChecks.reduce((sum, c) => sum + c.payment, 0);

      return {
         monthly_payment: (fixedPrincipalPerCheck + (checkInstallments[0]?.interest ?? 0)) / intervalMonths,
         total_months: totalMonths,
         total_payment: totalPayment,
         total_interest: totalPayment - principal,
         exact_total_interest: runningInterest,
         check_count: checkCount,
         check_amount: checkInstallments[0]?.payment ?? 0,  // نزولی است؛ قسط اول به‌عنوان نماینده
         check_interval_months: intervalMonths,
         installments: roundedChecks,
         is_valid: true
      };
   } else if (interestType === 'AVERAGE_BALANCE') {
      // بازاری — کسر از پایین: میانگین روزِ راسِ واقعی (نه فرمول نمادین بر مبنای ماه)
      const dailyRate = rateDecimal / 30;
      const daysArr: number[] = [];
      for (let i = 1; i <= checkCount; i++) {
         const { days } = addMonthsJalali(startDate || '', i * intervalMonths, todayDate);
         daysArr.push(days);
      }
      const avgDay = roundAvgDay(daysArr.reduce((s, d) => s + d, 0) / checkCount, dayRounding);
      const totalInterest = dailyRate * avgDay * principal;
      const totalAmount = principal + totalInterest;
      const checkPayment = totalAmount / checkCount;
      // تفکیک اصل/سود بر مبنای «پول × زمان» — توضیح کامل در شاخه‌ی متناظر در
      // calculateByCount. خلاصه: سود کل این روش از راسِ وزن‌دار می‌آید، پس سهم هر
      // چک از سود هم باید به نسبت (مبلغ × روز) باشد؛ تقسیم مساوی هم با مبنای روش
      // ناسازگار بود و هم با نامساوی‌شدن مبالغ، «سود منفی» می‌ساخت.
      const payPerCheckAB = Math.round(checkPayment);
      const dayWeightSumAB = daysArr.reduce((s, d) => s + d, 0);

      const checkInstallments: InstallmentScheduleItem[] = [];
      let allocatedPrincipalAB = 0;
      for (let i = 0; i < checkCount; i++) {
         const share = dayWeightSumAB > 0 ? daysArr[i] / dayWeightSumAB : 1 / checkCount;
         const interest_i = totalInterest * share;
         const principal_i = payPerCheckAB - interest_i;
         allocatedPrincipalAB += principal_i;
         checkInstallments.push({
            month: (i + 1) * intervalMonths,
            payment: payPerCheckAB,
            principal: Math.round(principal_i),
            interest: Math.round(interest_i),
            remaining: Math.max(0, Math.round(principal - allocatedPrincipalAB))
         });
      }

      const roundedChecks = applyRoundingToChecks(checkInstallments, principal, rounding);

      if (startDate) {
         addDueDates(roundedChecks, startDate, intervalMonths);
      }

      const totalPaymentAvg = roundedChecks.reduce((sum, c) => sum + c.payment, 0);

      return {
         monthly_payment: checkPayment / intervalMonths,
         total_months: totalMonths,
         total_payment: totalPaymentAvg,
         total_interest: totalPaymentAvg - principal,
         exact_total_interest: totalInterest,
         check_count: checkCount,
         check_amount: checkPayment,
         check_interval_months: intervalMonths,
         installments: roundedChecks,
         is_valid: true
      };
   } else {
      // قسط ثابت — روش بانکی: تبدیل نرخ به نرخ دوره‌ای
      const periodRate = Math.pow(1 + rateDecimal, intervalMonths) - 1;
      
      let checkPayment: number;
      if (periodRate === 0) {
         checkPayment = principal / checkCount;
      } else {
         const x = Math.pow(1 + periodRate, checkCount);
         checkPayment = (principal * periodRate * x) / (x - 1);
      }
      
      // ساخت جدول چک‌ها
      const checkInstallments: InstallmentScheduleItem[] = [];
      let remainingPrincipal = principal;
      
      for (let i = 0; i < checkCount; i++) {
         const interest = remainingPrincipal * periodRate;
         const principalPart = checkPayment - interest;
         remainingPrincipal -= principalPart;
         
         checkInstallments.push({
            month: (i + 1) * intervalMonths,
            payment: Math.round(checkPayment),
            principal: Math.round(principalPart),
            interest: Math.round(interest),
            remaining: Math.max(0, Math.round(remainingPrincipal))
         });
      }
      
      const roundedChecks = applyRoundingToChecks(checkInstallments, principal, rounding);
      
      if (startDate) {
         addDueDates(roundedChecks, startDate, intervalMonths);
      }
      
      // total_payment فقط جمع مبلغ چک‌هاست (هماهنگ با بازاری)؛ پیش‌پرداخت اینجا اضافه نمی‌شود
      const totalPayment = roundedChecks.reduce((sum, c) => sum + c.payment, 0);
      const totalInterest = totalPayment - principal;
      
      return {
         monthly_payment: checkPayment / intervalMonths,
         total_months: totalMonths,
         total_payment: totalPayment,
         total_interest: totalInterest,
         check_count: checkCount,
         check_amount: checkPayment,
         check_interval_months: intervalMonths,
         installments: roundedChecks,
         is_valid: true
      };
   }
}

/**
 * حالت 4: مبلغ ماهانه معلوم → تعداد چک محاسبه (چک چند ماهه)
 *
 * توجه: targetMonthlyPayment مبلغ ماهانه است (نه مبلغ چک).
 * حداکثر مبلغ هر چک = targetMonthlyPayment × intervalMonths
 * تعداد چک باید طوری باشه که مبلغ هر چک ÷ interval <= targetMonthlyPayment
 */
function calculateByCheckAmount(
   principal: number,
   rateDecimal: number,
   targetMonthlyPayment: number,
   intervalMonths: number,
   prepayment: number,
   interestType: InterestType,
   rounding: RoundingStrategy,
   startDate?: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {

   // حداکثر مبلغ هر چک = مبلغ ماهانه × فاصله
   const targetCheckPayment = targetMonthlyPayment * intervalMonths;

   let checkCount: number;

   if (interestType === 'SIMPLE' || interestType === 'FIXED_PRINCIPAL') {
      // سود ساده و اصل ثابت: قسط اول/ثابت هر دو با یک فرمول پیدا می‌شوند
      // checkPayment = principal/n + principal × نرخ دوره
      // «سود ساده» نرخ دوره‌اش خطی است (نرخ × فاصله) چون اصلاً روی مانده کار
      // نمی‌کند؛ «اصل ثابت» نرخ دوره‌ی مرکب دارد تا با جدولش هم‌خوان بماند.
      const minCheckPayment = interestType === 'FIXED_PRINCIPAL'
         ? principal * (Math.pow(1 + rateDecimal, intervalMonths) - 1)
         : principal * rateDecimal * intervalMonths;
      if (targetCheckPayment <= minCheckPayment && rateDecimal > 0) {
         return createInvalidResult(
            `مبلغ ماهانه باید بیشتر از ${Math.ceil(minCheckPayment / intervalMonths / 10).toLocaleString('fa-IR')} تومان باشد.`
         );
      }
      checkCount = rateDecimal === 0
         ? Math.ceil(principal / targetCheckPayment)
         : Math.ceil(principal / (targetCheckPayment - minCheckPayment));
      if (!isFinite(checkCount) || checkCount > MAX_INSTALLMENT_COUNT) {
         return createInvalidResult(
            tooManyInstallmentsMessage(principal, rateDecimal, MAX_INSTALLMENT_COUNT, intervalMonths, 'چک')
         );
      }
   } else if (interestType === 'AVERAGE_BALANCE') {
      // بازاری — کسر از پایین: چون فرمولش بر مبنای میانگین روزِ راسِ واقعیِ
      // تقویم است، تعداد چک را با جستجوی افزایشی پیدا می‌کنیم.
      const dailyRate = rateDecimal / 30;
      const minCheckPaymentAvg = principal * rateDecimal * intervalMonths / 2;
      if (targetCheckPayment <= minCheckPaymentAvg && rateDecimal > 0) {
         return createInvalidResult(
            `مبلغ ماهانه باید بیشتر از ${Math.ceil(minCheckPaymentAvg / intervalMonths / 10).toLocaleString('fa-IR')} تومان باشد.\n` +
            `در روش «کسر از پایین»، هرچقدر هم تعداد چک را زیاد کنید، قسط از این مبلغ پایین‌تر نمی‌آید.`
         );
      }
      checkCount = 1;
      let foundCheck = false;
      while (checkCount <= MAX_INSTALLMENT_COUNT) {
         const daysArr: number[] = [];
         for (let i = 1; i <= checkCount; i++) {
            const { days } = addMonthsJalali(startDate || '', i * intervalMonths, todayDate);
            daysArr.push(days);
         }
         const avgDay = roundAvgDay(daysArr.reduce((s, d) => s + d, 0) / checkCount, dayRounding);
         const totalInterest = dailyRate * avgDay * principal;
         const checkPayment = (principal + totalInterest) / checkCount;
         if (checkPayment <= targetCheckPayment) { foundCheck = true; break; }
         checkCount++;
      }
      if (!foundCheck) {
         return createInvalidResult(
            `با این مبلغ ماهانه، تعداد چک‌ها از حد مجاز (${MAX_INSTALLMENT_COUNT.toLocaleString('fa-IR')} چک) بیشتر می‌شود. مبلغ ماهانه را بالاتر ببرید.`
         );
      }
   } else {
      // قسط ثابت — روش بانکی: از نرخ دوره‌ای مستقیم استفاده می‌کنیم
      // r_period = (1+r)^interval - 1
      // n = log(PMT / (PMT - P*r_period)) / log(1 + r_period)
      const periodRate = Math.pow(1 + rateDecimal, intervalMonths) - 1;
      const minCheckPayment = principal * periodRate;
      if (targetCheckPayment <= minCheckPayment && periodRate > 0) {
         return createInvalidResult(
            `مبلغ ماهانه باید بیشتر از ${Math.ceil(minCheckPayment / intervalMonths / 10).toLocaleString('fa-IR')} تومان باشد.`
         );
      }
      if (periodRate === 0) {
         checkCount = Math.ceil(principal / targetCheckPayment);
      } else {
         const n = Math.log(targetCheckPayment / (targetCheckPayment - principal * periodRate)) / Math.log(1 + periodRate);
         checkCount = Math.ceil(n);
      }
      if (!isFinite(checkCount) || checkCount > MAX_INSTALLMENT_COUNT) {
         return createInvalidResult(
            tooManyInstallmentsMessage(principal, rateDecimal, MAX_INSTALLMENT_COUNT, intervalMonths, 'چک')
         );
      }
   }

   return calculateByCheckCount(principal, rateDecimal, checkCount, intervalMonths, prepayment, interestType, rounding, startDate, todayDate, dayRounding);
}

/**
 * ساخت جدول اقساط برای «قسط ثابت — روش بانکی»
 */
function buildInstallmentSchedule(
   principal: number,
   rateDecimal: number,
   monthlyPayment: number,
   count: number
): InstallmentScheduleItem[] {
   const installments: InstallmentScheduleItem[] = [];
   let remainingPrincipal = principal;
   
   for (let i = 0; i < count; i++) {
      const interest = remainingPrincipal * rateDecimal;
      let principalPart = monthlyPayment - interest;
      
      // اگر ماه آخر است
      if (i === count - 1) {
         principalPart = remainingPrincipal;
      }
      
      remainingPrincipal -= principalPart;
      
      installments.push({
         month: i + 1,
         payment: Math.round(monthlyPayment),
         principal: Math.round(principalPart),
         interest: Math.round(interest),
         remaining: Math.max(0, Math.round(remainingPrincipal))
      });
   }
   
   return installments;
}

/**
 * جمع کردن اقساط ماهانه به چک‌های چند ماهه
 */
export function groupInstallmentsToChecks(
   installments: InstallmentScheduleItem[],
   intervalMonths: number
): InstallmentScheduleItem[] {
   const checks: InstallmentScheduleItem[] = [];
   
   for (let i = 0; i < installments.length; i += intervalMonths) {
      let checkPayment = 0;
      let checkPrincipal = 0;
      let checkInterest = 0;
      
      for (let j = 0; j < intervalMonths && (i + j) < installments.length; j++) {
         const inst = installments[i + j];
         checkPayment += inst.payment;
         checkPrincipal += inst.principal;
         checkInterest += inst.interest;
      }
      
      const lastInGroup = installments[Math.min(i + intervalMonths - 1, installments.length - 1)];
      
      checks.push({
         month: lastInGroup.month,
         payment: Math.round(checkPayment),
         principal: Math.round(checkPrincipal),
         interest: Math.round(checkInterest),
         remaining: lastInGroup.remaining
      });
   }
   
   return checks;
}

/**
 * اعمال رُند کردن روی اقساط
 */
export function applyRounding(
   installments: InstallmentScheduleItem[],
   principal: number,
   strategy: RoundingStrategy
): InstallmentScheduleItem[] {
   switch (strategy) {
      case 'EXACT':
         return installments;
         
      case 'FIRST_INSTALLMENT':
         return applyFirstInstallmentRounding(installments);
         
      case 'LAST_INSTALLMENT':
         return applyLastInstallmentRounding(installments);
         
      case 'ROUND_UP_1K':
         return applyRoundUpStrategy(installments, 10000);  // 1K تومان = 10K ریال

      case 'ROUND_DOWN_1K':
         return applyRoundDownStrategy(installments, 10000);

      case 'ROUND_UP_5K':
         return applyRoundUpStrategy(installments, 50000);  // 5K تومان = 50K ریال
         
      case 'ROUND_DOWN_5K':
         return applyRoundDownStrategy(installments, 50000);
         
      case 'ROUND_UP_10K':
         return applyRoundUpStrategy(installments, 100000);  // 10K تومان = 100K ریال
         
      case 'ROUND_DOWN_10K':
         return applyRoundDownStrategy(installments, 100000);
         
      case 'ROUND_UP_50K':
         return applyRoundUpStrategy(installments, 500000);  // 50K تومان = 500K ریال
         
      case 'ROUND_DOWN_50K':
         return applyRoundDownStrategy(installments, 500000);
         
      case 'ROUND_UP_100K':
         return applyRoundUpStrategy(installments, 1000000);  // 100K تومان = 1M ریال
         
      case 'ROUND_DOWN_100K':
         return applyRoundDownStrategy(installments, 1000000);
         
      default:
         return installments;
   }
}

/**
 * رُند کردن به سمت پایین و اضافه به قسط اول
 */
function applyFirstInstallmentRounding(
   installments: InstallmentScheduleItem[]
): InstallmentScheduleItem[] {
   if (installments.length === 0) return installments;
   const roundTo = 10000; // 1000 تومان
   // قسط‌های 2 تا آخر به پایین گرد می‌شوند
   const rest = installments.slice(1).map(inst => ({
      ...inst,
      payment: Math.floor(inst.payment / roundTo) * roundTo
   }));
   const restTotal = rest.reduce((s, i) => s + i.payment, 0);
   // کل واقعی (جمع اصلی قبل از گرد کردن)
   const realTotal = installments.reduce((s, i) => s + i.payment, 0);
   // قسط اول = کل - بقیه
   const firstRaw = realTotal - restTotal;
   // ابتدا به 1 تومان (10 ریال) گرد کن تا خطای floating point حذف بشه
   const firstTo1Toman = Math.round(firstRaw / 10) * 10;
   // بعد به 1000 تومان (10000 ریال) گرد کن — خرده زیر 1000 تومان حذف میشه
   const firstPayment = Math.round(firstTo1Toman / roundTo) * roundTo;
   return [{ ...installments[0], payment: firstPayment }, ...rest];
}

/**
 * رُند کردن به سمت پایین و اضافه به قسط آخر
 */
function applyLastInstallmentRounding(
   installments: InstallmentScheduleItem[]
): InstallmentScheduleItem[] {
   if (installments.length === 0) return installments;
   const roundTo = 10000;
   // قسط‌های 1 تا ماقبل آخر به پایین گرد
   const main = installments.slice(0, -1).map(inst => ({
      ...inst,
      payment: Math.floor(inst.payment / roundTo) * roundTo
   }));
   const mainTotal = main.reduce((s, i) => s + i.payment, 0);
   const realTotal2 = installments.reduce((s, i) => s + i.payment, 0);
   // قسط آخر = کل - بقیه
   const lastRaw = realTotal2 - mainTotal;
   // مستقیم به 1000 تومان (10000 ریال) گرد کن
   const lastPayment = Math.round(lastRaw / roundTo) * roundTo;
   return [...main, { ...installments[installments.length - 1], payment: lastPayment }];
}

/**
 * رُند کردن به بالا
 */
function applyRoundUpStrategy(
   installments: InstallmentScheduleItem[],
   roundTo: number
): InstallmentScheduleItem[] {
   return installments.map(inst => ({
      ...inst,
      payment: Math.ceil(inst.payment / roundTo) * roundTo
   }));
}

/**
 * رُند کردن به پایین
 */
function applyRoundDownStrategy(
   installments: InstallmentScheduleItem[],
   roundTo: number
): InstallmentScheduleItem[] {
   return installments.map(inst => ({
      ...inst,
      payment: Math.floor(inst.payment / roundTo) * roundTo
   }));
}

/**
 * اعمال رُند روی چک‌ها
 */
export function applyRoundingToChecks(
   checks: InstallmentScheduleItem[],
   principal: number,
   strategy: RoundingStrategy
): InstallmentScheduleItem[] {
   return applyRounding(checks, principal, strategy);
}

/**
 * اضافه کردن تاریخ سررسید
 */
function addDueDates(
   installments: InstallmentScheduleItem[],
   startDate: string,
   intervalMonths: number = 1
): void {
   installments.forEach((inst, idx) => {
      inst.due_date = addMonthsToJalaliDate(startDate, (idx + 1) * intervalMonths);
   });
}

/**
 * اضافه کردن ماه به تاریخ شمسی
 */
function addMonthsToJalaliDate(jalaliDate: string, months: number): string {
   const parts = jalaliDate.split('/');
   if (parts.length !== 3) return jalaliDate;
   
   let year = parseInt(parts[0]);
   let month = parseInt(parts[1]);
   let day = parseInt(parts[2]);
   
   month += months;
   while (month > 12) {
      month -= 12;
      year += 1;
   }
   
   // تصحیح روز برای ماه‌های 30 روزه
   if (month >= 7 && month <= 11 && day > 30) day = 30;
   if (month === 12 && day > 29) day = 29;
   
   return `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
}

/**
 * ایجاد نتیجه نامعتبر
 */
function createInvalidResult(message: string): InstallmentCalculationResult {
   return {
      monthly_payment: 0,
      total_months: 0,
      total_payment: 0,
      total_interest: 0,
      installments: [],
      is_valid: false,
      warning_message: message
   };
}

// ─────────────────────────────────────────────────────────────────────────────
// محاسبه بازاری (معکوس راس‌گیری)
// ─────────────────────────────────────────────────────────────────────────────

function toJalali(gy: number, gm: number, gd: number): string {
   const g_y = gy - 1600, g_m = gm - 1, g_d = gd - 1;
   let g_d_no = 365*g_y + Math.floor((g_y+3)/4) - Math.floor((g_y+99)/100) + Math.floor((g_y+399)/400);
   const gm_days = [31,28,31,30,31,30,31,31,30,31,30,31];
   for (let i=0; i<g_m; i++) g_d_no += gm_days[i];
   if (g_m>1 && ((gy%4===0&&gy%100!==0)||gy%400===0)) g_d_no++;
   g_d_no += g_d;
   let j_d_no = g_d_no - 79;
   const j_np = Math.floor(j_d_no/12053); j_d_no %= 12053;
   let jy = 979 + 33*j_np + 4*Math.floor(j_d_no/1461); j_d_no %= 1461;
   if (j_d_no >= 366) { jy += Math.floor((j_d_no-1)/365); j_d_no = (j_d_no-1)%365; }
   const jm_d = [31,31,31,31,31,31,30,30,30,30,30,29];
   let jm=0, jd=0;
   for (let i=0; i<11; i++) { if (j_d_no>=jm_d[i]) { j_d_no-=jm_d[i]; jm++; } else { jm++; jd=j_d_no+1; break; } }
   if (jd===0) { jm=12; jd=j_d_no+1; }
   return `${jy}/${String(jm).padStart(2,'0')}/${String(jd).padStart(2,'0')}`;
}

/**
 * گردکردن «میانگین روز راس» طبق تنظیم کاربر (همان تنظیمی که در راس‌گیر اعمال می‌شود).
 * اگر این‌جا اعمال نشود، محاسبه‌ی اقساط و راس‌گیر دیگر معکوس دقیق هم نیستند و
 * چک‌های تولیدشده وقتی نزد صراف/راس‌گیر می‌روند، عدد کمی متفاوت می‌دهند.
 */
export type DayRounding = 'NONE' | 'ROUND_UP' | 'ROUND_DOWN';
export function roundAvgDay(avgDay: number, mode?: DayRounding): number {
   if (mode === 'ROUND_UP') return Math.ceil(avgDay);
   if (mode === 'ROUND_DOWN') return Math.floor(avgDay);
   return avgDay;
}

/** آیا سال شمسی کبیسه است؟ (اسفند ۳۰ روزه) — بر مبنای همان تقویمی که jalaliDaysBetween استفاده می‌کند */
export function isJalaliLeapYear(year: number): boolean {
   if (!year || !isFinite(year)) return false;
   return jalaliDaysBetween(`${year}/01/01`, `${year + 1}/01/01`) === 366;
}

/**
 * آیا رشته‌ی داده‌شده یک تاریخ شمسیِ *واقعی* است؟
 * فقط فرمت را چک نمی‌کند؛ شماره‌ی ماه و تعداد روز ماه (با احتساب اسفندِ کبیسه)
 * را هم بررسی می‌کند. قبلاً فقط الگوی ۴/۲/۲ چک می‌شد و تاریخی مثل ۱۴۰۵/۱۳/۴۵
 * وارد جدول می‌شد و همه‌ی روزشمارها را خراب می‌کرد.
 */
export function isValidJalaliDate(date?: string): boolean {
   if (!date) return false;
   const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(date.trim());
   if (!m) return false;
   const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
   if (y < 1300 || y > 1500) return false;
   if (mo < 1 || mo > 12) return false;
   if (d < 1) return false;
   return d <= jalaliDaysInMonth(mo, y);
}

/** تاریخ شمسی را با ماه/روز دو رقمی نرمال می‌کند (۱۴۰۵/۵/۳ → ۱۴۰۵/۰۵/۰۳) */
export function normalizeJalaliDate(date: string): string {
   const p = date.trim().split('/');
   if (p.length !== 3) return date.trim();
   return `${p[0]}/${p[1].padStart(2, '0')}/${p[2].padStart(2, '0')}`;
}

function jalaliDaysInMonth(month: number, year?: number): number {
   if (month <= 6) return 31;
   if (month <= 11) return 30;
   // اسفند: در سال‌های کبیسه ۳۰ روز است، نه ۲۹
   return year && isJalaliLeapYear(year) ? 30 : 29;
}

/** اضافه کردن N ماه به تاریخ شمسی — برگشت تاریخ + روزهای دقیق */
function addMonthsJalali(startDate: string, months: number, daysFromDate?: string): { date: string; days: number } {
   const parts = startDate.split('/');
   if (parts.length !== 3) return { date: startDate, days: months * 30 };
   const year = parseInt(parts[0]), month = parseInt(parts[1]), day = parseInt(parts[2]);
   let newYear = year, newMonth = month + months;
   while (newMonth > 12) { newMonth -= 12; newYear++; }
   let newDay = day;
   if (newMonth >= 7 && newMonth <= 11 && newDay > 30) newDay = 30;
   if (newMonth === 12 && newDay > 29) newDay = 29;
   const dueDate = `${newYear}/${String(newMonth).padStart(2,'0')}/${String(newDay).padStart(2,'0')}`;
   // اگر daysFromDate داده شده، روزها رو از اون مرجع حساب کن (نه از startDate)
   let totalDays: number;
   if (daysFromDate) {
      const diff = jalaliDaysBetween(daysFromDate, dueDate);
      // اگه تاریخ سررسید قبل از today بود یا نامعتبر → fallback به محاسبه استاندارد
      if (diff <= 0) {
         totalDays = countJalaliDays(year, month, months);
      } else {
         totalDays = diff;
      }
   } else {
      totalDays = countJalaliDays(year, month, months);
   }
   return { date: dueDate, days: totalDays };
}

/** شمارش روزهای واقعی N ماه، از ماه/سال داده‌شده (با احتساب اسفندِ کبیسه) */
function countJalaliDays(year: number, month: number, months: number): number {
   let d = 0, curMonth = month, curYear = year;
   for (let m = 0; m < months; m++) {
      d += jalaliDaysInMonth(curMonth, curYear);
      curMonth++;
      if (curMonth > 12) { curMonth = 1; curYear++; }
   }
   return d;
}

/** تاریخ امروز به شمسی، بر مبنای وقت رسمی ایران (نه ساعت سرور) */
export function getTodayJalaliTehran(): string {
   try {
      const parts = new Intl.DateTimeFormat('en-CA', {
         timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date()).split('-').map(Number);
      return toJalali(parts[0], parts[1], parts[2]);
   } catch {
      const d = new Date();
      return toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
   }
}

/** اختلاف روز بین دو تاریخ شمسی (برای ویرایش تاریخ در جدول) */
export function jalaliDaysBetween(from: string, to: string): number {
   function toAbs(d: string): number {
      const p = d.split('/');
      const jy = parseInt(p[0])-979, jm = parseInt(p[1])-1, jd = parseInt(p[2])-1;
      let days = 365*jy + Math.floor(jy/33)*8 + Math.floor((jy%33+3)/4);
      const jm_d = [31,31,31,31,31,31,30,30,30,30,30,29];
      for (let i=0; i<jm; i++) days += jm_d[i];
      return days + jd;
   }
   return toAbs(to) - toAbs(from);
}

/**
 * بیشترین سررسید (به روز) که روش «کسر از بالا» برایش معنی دارد.
 * این روش هر چک را با کسر ساده تنزیل می‌کند: PV = مبلغ × (۱ − نرخ‌روزانه × روز).
 * اگر «نرخ‌روزانه × روز» به ۱ برسد، ارزش امروزِ آن چک صفر (و بعد از آن منفی) می‌شود
 * که از نظر مالی بی‌معنی است. با نرخ ۵٪ ماهانه این مرز ۶۰۰ روز (۲۰ ماه) است.
 */
export function marketMaxDays(monthlyRate: number): number {
   if (monthlyRate <= 0) return Infinity;
   return 3000 / monthlyRate;   // = 1 / (monthlyRate/100/30)
}

/**
 * محاسبه بازاری — COUNT
 * فرمول: X = Principal / (n - dailyRate × Σdays_i)
 */
export function calculateMarketByCount(
   principal: number,
   monthlyRate: number,
   checkCount: number,
   intervalMonths: number,
   rounding: RoundingStrategy,
   startDate: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {
   if (principal <= 0) return createInvalidResult('مبلغ اصل باید مثبت باشد');
   if (checkCount <= 0) return createInvalidResult('تعداد چک باید مثبت باشد');
   const dailyRate = monthlyRate / 100 / 30;
   const dueDates: string[] = [];
   const daysArr: number[] = [];
   let totalDays = 0;
   for (let i = 1; i <= checkCount; i++) {
      const { date, days } = addMonthsJalali(startDate, i * intervalMonths, todayDate);
      dueDates.push(date); daysArr.push(days); totalDays += days;
   }
   // ─── گارد ۱: سررسید چک آخر از حد اعتبار این روش عبور نکند ───
   const maxDays = marketMaxDays(monthlyRate);
   const lastDay = daysArr[daysArr.length - 1] ?? 0;
   if (lastDay >= maxDays) {
      const maxMonths = Math.floor(maxDays / 30);
      return createInvalidResult(
         `با نرخ ${monthlyRate}٪ ماهانه، روش «بازاری - کسر از بالا» فقط تا حدود ${maxMonths} ماه (${Math.floor(maxDays)} روز) معتبر است، ` +
         `اما سررسید چک آخر ${lastDay} روز است. تعداد یا فاصله‌ی چک‌ها را کم کنید، نرخ را پایین بیاورید، ` +
         `یا از روش «اصل ثابت» / «قسط ثابت بانکی» استفاده کنید.`
      );
   }

   // گردکردن روز راس دقیقاً مثل راس‌گیر، تا دو ابزار معکوس دقیق هم بمانند
   const effectiveTotalDays = roundAvgDay(totalDays / checkCount, dayRounding) * checkCount;
   const denominator = checkCount - dailyRate * effectiveTotalDays;
   if (denominator <= 0 || !isFinite(denominator)) {
      const maxMonths = Math.floor(maxDays / 30);
      return createInvalidResult(
         `ترکیب نرخ ${monthlyRate}٪ ماهانه با این مدت بازپرداخت، در روش «بازاری - کسر از بالا» جواب ندارد ` +
         `(مجموع کسر از چک‌ها از کل مبلغ آن‌ها بیشتر می‌شود). این روش تا حدود ${maxMonths} ماه معتبر است؛ ` +
         `برای مدت‌های طولانی‌تر از «اصل ثابت» یا «قسط ثابت بانکی» استفاده کنید.`
      );
   }
   // checkAmount رو به ریال گرد میکنیم تا رند کردن بعدی درست کار کنه
   const checkAmountRaw = principal / denominator;
   const checkAmount = Math.round(checkAmountRaw); // گرد به ریال (= 10 تومان)
   // تفکیک اصل و سود هر چک باید با *همان* فرمولی باشد که مبلغ چک از آن درآمده،
   // یعنی کسر ساده: PV = مبلغ × (۱ − نرخ‌روزانه × روز).
   // (قبلاً از فرمول ناسازگارِ مبلغ ÷ (۱ + نرخ‌روزانه × روز) استفاده می‌شد و به همین دلیل
   //  جمع ستون «اصل» به‌جای مبلغ وام، حدود ۴٪ بیشتر درمی‌آمد.)
   let pvSum = 0;
   const installments: InstallmentScheduleItem[] = daysArr.map((days, i) => {
      const pv = checkAmount * (1 - dailyRate * days);
      pvSum += pv;
      return {
         month: (i+1)*intervalMonths,
         payment: Math.round(checkAmount),
         principal: Math.round(pv),
         interest: Math.round(checkAmount - pv),
         remaining: Math.max(0, Math.round(principal - pvSum)),
         due_date: dueDates[i]
      };
   });
   // برای گردکردن بازاری: total = n × checkAmount (نه principal + interest)
   // applyRounding از principal + totalInterest استفاده میکنه که برای بازاری اشتباهه
   // پس اگه EXACT باشه همان، وگرنه از تابع gRounding استفاده میکنیم
   let rounded: InstallmentScheduleItem[];
   if (rounding === 'EXACT') {
      rounded = installments;
   } else if (rounding === 'FIRST_INSTALLMENT' || rounding === 'LAST_INSTALLMENT') {
      // گرد کردن: بقیه به پایین‌ترین مضرب، اول/آخر جبران می‌کند
      // هر دو قسط اول/آخر هم گرد می‌شوند (اختلاف ناچیز قابل قبول است)
      const roundTo = 10000; // ریال = 1000 تومان
      if (rounding === 'FIRST_INSTALLMENT') {
         // بقیه چک‌ها به پایین گرد → خرده جمع میشه روی چک اول
         const restRounded = installments.slice(1).map(i => ({ ...i, payment: Math.floor(i.payment / roundTo) * roundTo }));
         const restTotal = restRounded.reduce((s,i) => s + i.payment, 0);
         const firstRaw = Math.round(checkAmount) * checkCount - restTotal;
         // چک اول هم گرد میشه به roundTo (خرده زیر 1000 تومان حذف)
         const firstPay = Math.round(firstRaw / roundTo) * roundTo;
         rounded = [{ ...installments[0], payment: firstPay }, ...restRounded];
      } else {
         // بقیه چک‌ها به پایین گرد → خرده جمع میشه روی چک آخر
         const mainRounded = installments.slice(0,-1).map(i => ({ ...i, payment: Math.floor(i.payment / roundTo) * roundTo }));
         const mainTotal = mainRounded.reduce((s,i) => s + i.payment, 0);
         const lastRaw = Math.round(checkAmount) * checkCount - mainTotal;
         // چک آخر هم گرد میشه به roundTo (خرده زیر 1000 تومان حذف)
         const lastPay = Math.round(lastRaw / roundTo) * roundTo;
         rounded = [...mainRounded, { ...installments[installments.length-1], payment: lastPay }];
      }
   } else {
      rounded = applyRoundingToChecks(installments, principal, rounding);
   }
   const totalPayment = rounded.reduce((s, i) => s + i.payment, 0);

   // هشدار نرم: هرچه مدت بلندتر شود، این روش با شتاب از نرخ اسمی فاصله می‌گیرد.
   const stretch = dailyRate * (effectiveTotalDays / checkCount);   // = نرخ روزانه × میانگین روز راس
   const warning = stretch > 0.35
      ? `هشدار: در این مدت، روش «کسر از بالا» سود را به‌شدت بیشتر از نرخ اسمی ${monthlyRate}٪ حساب می‌کند. ` +
        `پیش از نهایی‌کردن، نتیجه را با روش «اصل ثابت» یا «قسط ثابت بانکی» مقایسه کنید.`
      : undefined;

   return {
      monthly_payment: Math.round(checkAmount / intervalMonths),
      total_months: checkCount * intervalMonths,
      total_payment: totalPayment,
      total_interest: totalPayment - principal,
      check_count: checkCount,
      check_amount: Math.round(checkAmount),
      check_interval_months: intervalMonths,
      installments: rounded,
      is_valid: true,
      warning_message: warning,
   };
}

/**
 * محاسبه بازاری — AMOUNT
 * فرمول ۱ (بازاری): n رو پیدا کن که X=P/(n-r*Σd) ≤ target
 * یعنی: n را زیاد کن تا checkAmount به target برسه یا کمتر بشه
 */
export function calculateMarketByAmount(
   principal: number,
   monthlyRate: number,
   targetCheckPayment: number,
   intervalMonths: number,
   rounding: RoundingStrategy,
   startDate: string,
   todayDate?: string,
   dayRounding?: DayRounding
): InstallmentCalculationResult {
   const maxChecks = 360;
   if (principal <= 0) return createInvalidResult('مبلغ اصل باید مثبت باشد');
   if (targetCheckPayment <= 0) return createInvalidResult('مبلغ چک باید مثبت باشد');
   const dailyRate = monthlyRate / 100 / 30;
   const maxDays = marketMaxDays(monthlyRate);

   // ─── نکته‌ی کلیدی این روش ───
   // مبلغ چک با زیادکردن تعداد چک، *همیشه* کم نمی‌شود: اول کم می‌شود، به یک کف می‌رسد،
   // و بعد دوباره بالا می‌رود (چون کسر روزشمار روی چک‌های دور، مخرج فرمول را می‌خورد).
   // پس باید کف واقعی را پیدا کنیم، نه اینکه کورکورانه تعداد را زیاد کنیم.
   let n = 0, sumDays = 0, minPossible = Infinity, minAtCount = 0;
   for (let k = 1; k <= maxChecks; k++) {
      const { days } = addMonthsJalali(startDate, k * intervalMonths, todayDate);
      if (days >= maxDays) break;               // از حد اعتبار این روش گذشتیم
      sumDays += days;
      const denominator = k - dailyRate * roundAvgDay(sumDays / k, dayRounding) * k;
      if (denominator <= 0) break;              // فرمول دیگر جواب ندارد
      const X = principal / denominator;
      if (X < minPossible) { minPossible = X; minAtCount = k; }
      if (X <= targetCheckPayment) { n = k; break; }
   }

   if (n === 0) {
      if (!isFinite(minPossible)) {
         return createInvalidResult(
            `با نرخ ${monthlyRate}٪ ماهانه، روش «بازاری - کسر از بالا» برای این مبلغ جواب ندارد. ` +
            `نرخ را کم کنید یا از روش «اصل ثابت» / «قسط ثابت بانکی» استفاده کنید.`
         );
      }
      return createInvalidResult(
         `با نرخ ${monthlyRate}٪ ماهانه و این مبلغ، کمترین چکِ ممکن در روش «بازاری - کسر از بالا» ` +
         `حدود ${Math.ceil(minPossible/10).toLocaleString('fa-IR')} تومان است (با ${minAtCount.toLocaleString('fa-IR')} چک). ` +
         `زیر این مبلغ، هرچقدر هم تعداد چک را زیاد کنید قسط کمتر نمی‌شود — چون در این روش چک‌های خیلی دور، ` +
         `خودشان بیشتر از ارزششان کسر می‌خورند. مبلغ چک را بالاتر ببرید یا روش دیگری انتخاب کنید.`
      );
   }

   // محاسبه نهایی با n چک
   return calculateMarketByCount(principal, monthlyRate, n, intervalMonths, rounding, startDate, todayDate, dayRounding);
}

// محاسبه تاریخ شروع از تاریخ چک اول (n ماه قبل از چک اول)
// نکته: روز باید با طول ماه مقصد هماهنگ شود؛ وگرنه تاریخ‌هایی مثل ۱۴۰۴/۱۲/۳۱
// (اسفند ۳۱ روزه!) ساخته می‌شد که تاریخ شمسیِ واقعی نیست و روزشمار را خراب می‌کند.
export function calcStartDateFromFirstCheck(firstCheckDate: string, intervalMonths: number): string {
   const parts = firstCheckDate.trim().split('/');
   if (parts.length !== 3) return '';
   let year = parseInt(parts[0]);
   let month = parseInt(parts[1]);
   let day = parseInt(parts[2]);
   if (!year || !month || !day) return '';
   month -= intervalMonths;
   while (month <= 0) { month += 12; year -= 1; }
   const maxDay = month <= 6 ? 31 : month <= 11 ? 30 : (isJalaliLeapYear(year) ? 30 : 29);
   if (day > maxDay) day = maxDay;
   return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}
