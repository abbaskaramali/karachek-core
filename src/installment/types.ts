// انواع محاسبه اقساط
export type InstallmentCalculationMode = 
   | 'COUNT'          // تعداد قسط معلوم → مبلغ محاسبه
   | 'AMOUNT'         // مبلغ قسط معلوم → تعداد محاسبه
   | 'CHECK_COUNT'    // تعداد چک معلوم → مبلغ چک محاسبه
   | 'CHECK_AMOUNT';  // مبلغ چک معلوم → تعداد محاسبه

// نوع سود
export type InterestType = 
   | 'SIMPLE'            // سود ساده بدون راس
   | 'FIXED_PRINCIPAL'   // اصل ثابت (سود ساده نزولی روی مانده واقعی)
   | 'AVERAGE_BALANCE'   // میانگین‌مانده (نسخه مساوی‌شده اصل ثابت)
   | 'COMPOUND'          // قسط ثابت — روش بانکی (قبلاً «سود مرکب» نامیده می‌شد؛ نام تغییر کرد، مقدار داخلی همان COMPOUND ماند)
   | 'MARKET';           // محاسبه بازاری (معکوس راس‌گیری)

// روش‌های رُند کردن
export type RoundingStrategy = 
   | 'EXACT'              // دقیق - بدون رُند
   | 'FIRST_INSTALLMENT'  // بازاری - مابه‌التفاوت در قسط اول
   | 'LAST_INSTALLMENT'   // بازاری - مابه‌التفاوت در قسط آخر
   | 'ROUND_UP_1K'        // گرد به بالا 1 هزار تومان
   | 'ROUND_DOWN_1K'      // گرد به پایین 1 هزار تومان
   | 'ROUND_UP_5K'        // گرد به بالا 5 هزار تومان
   | 'ROUND_DOWN_5K'      // گرد به پایین 5 هزار تومان
   | 'ROUND_UP_10K'       // گرد به بالا 10 هزار تومان
   | 'ROUND_DOWN_10K'     // گرد به پایین 10 هزار تومان
   | 'ROUND_UP_50K'       // گرد به بالا 50 هزار تومان
   | 'ROUND_DOWN_50K'     // گرد به پایین 50 هزار تومان
   | 'ROUND_UP_100K'      // گرد به بالا 100 هزار تومان
   | 'ROUND_DOWN_100K';   // گرد به پایین 100 هزار تومان

export type Installment_Type = 'installment_number' | 'installment_price';

export interface InstallmentCalculationInput {
   mode: InstallmentCalculationMode;
   total_loan: number;           // مبلغ کل (ریال)
   prepayment: number;           // پیش پرداخت (ریال)
   monthly_rate: number;         // نرخ بهره ماهانه (درصد)
   interest_type: InterestType;  // نوع سود
   rounding_strategy: RoundingStrategy;

   // گردکردن «میانگین روز راس» — باید با تنظیم raas_day_rounding کاربر یکی باشد،
   // وگرنه خروجی محاسبه‌ی اقساط با راس‌گیر همان کاربر یکی درنمی‌آید.
   day_rounding?: 'NONE' | 'ROUND_UP' | 'ROUND_DOWN';
   
   // برای حالت COUNT و CHECK_COUNT
   count?: number;               // تعداد اقساط یا چک‌ها
   
   // برای حالت AMOUNT و CHECK_AMOUNT
   target_payment?: number;      // مبلغ هدف (ریال)
   
   // برای حالت‌های CHECK
   check_interval_months?: number; // فاصله ماه‌های هر چک (1=ماهانه، 2=2ماهه، 3=3ماهه)
   
   // محدودیت‌ها
   max_months?: number;          // حداکثر ماه مجاز
   
   name?: string;
   product_name?: string;
   start_date?: string;
   today_date?: string;  // تاریخ امروز برای محاسبه روزهای واقعی          // تاریخ شروع (شمسی) - برای محاسبه سررسید
}

export interface InstallmentScheduleItem {
   month: number;
   payment: number;              // مبلغ این قسط (ریال)
   principal: number;            // اصل در این قسط (ریال)
   interest: number;             // سود در این قسط (ریال)
   remaining: number;            // باقیمانده بعد از پرداخت (ریال)
   due_date?: string;            // تاریخ سررسید (شمسی)
}

export interface InstallmentCalculationResult {
   monthly_payment: number;      // مبلغ قسط ماهانه (ریال)
   total_months: number;         // تعداد کل ماه‌ها
   total_payment: number;        // مجموع پرداختی — دقیقاً جمع همان چک‌های جدول (ریال)
   total_interest: number;       // کل سود = total_payment − اصل (ریال)

   // سود پیش از گردکردن (فقط برای نمایش/گزارش؛ مبنای پرداخت نیست)
   exact_total_interest?: number;

   // نرخ سود «مؤثر» واقعی این جدول (IRR ماهانه، اعشاری: 0.0582 = ۵.۸۲٪).
   // تنها معیار منصفانه برای مقایسه‌ی روش‌ها با هم است.
   effective_monthly_rate?: number;
   
   // برای حالت‌های چک
   check_count?: number;         // تعداد چک‌ها
   check_amount?: number;        // مبلغ هر چک (ریال)
   check_interval_months?: number;
   
   // جزئیات اقساط
   installments: InstallmentScheduleItem[];
   
   is_valid: boolean;
   warning_message?: string;
   info_message?: string;
}

export interface T_installment {
   _id: string;
   type: Installment_Type;
   mode: InstallmentCalculationMode;
   interest_type: InterestType;
   total_loan: number;
   prepayment: number;
   monthly_rate: number;
   installments_number: number;
   monthly_price: number;
   total_interest: number;
   total_refund: number;
   rounding_strategy: RoundingStrategy;
   check_interval_months?: number;
   check_count?: number;
   check_amount?: number;
   /** تاریخ شروع محاسبه (شمسی) — از «تاریخ چک اول» ساخته می‌شود */
   start_date?: string;
   day_rounding?: 'NONE' | 'ROUND_UP' | 'ROUND_DOWN';
   target_payment?: number;
   product_name?: string;
   calculated_schedule?: InstallmentScheduleItem[];
   installment_schedule?: InstallmentScheduleItem[];
   user_id: string;
   created_at: string;
   updated_at: string;
   name?: string;
   user_saved?: boolean;
   active: boolean;
}

// تنظیمات پیش‌فرض کاربر
export interface UserInstallmentSettings {
   default_interest_type: InterestType;
   default_rounding: RoundingStrategy;
   max_installment_months: number;
   allow_multi_month_checks: boolean;
}
