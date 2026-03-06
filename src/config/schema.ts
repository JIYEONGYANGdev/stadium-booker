import { z } from 'zod';

export const CredentialsSchema = z.object({
  id: z.string(),
  password: z.string(),
});

export const TimeSlotSchema = z.object({
  day: z.enum([
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ]),
  time: z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, '시간 형식: HH:MM-HH:MM'),
});

export const OpenScheduleSchema = z.object({
  type: z.enum(['monthly', 'weekly', 'daily']),
  day: z.number().min(1).max(31).optional(),
  day_of_week: z.enum([
    'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
  ]).optional(),
  time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/, '시간 형식: HH:MM:SS'),
});

export const RetrySchema = z.object({
  max_attempts: z.number().min(1).max(10).default(3),
  delay_ms: z.number().min(100).max(10000).default(500),
});

export const ReservationFormSchema = z.object({
  event_name: z.string().optional(),
  headcount: z.number().min(1).default(10),
  purpose: z.string().default('동호회 활동'),
  phone: z.string().optional(),
}).optional();

export const ReservationSchema = z.object({
  name: z.string(),
  site: z.string(),
  facility: z.string(),
  court: z.string(),
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferred_slots: z.array(TimeSlotSchema).min(1),
  multi_slot: z.boolean().optional(),
  prelogin_minutes: z.number().min(0).max(60).optional(),
  open_schedule: OpenScheduleSchema,
  retry: RetrySchema.optional(),
  form: ReservationFormSchema,
});

export const CaptchaConfigSchema = z.object({
  primary: z.enum(['tesseract', 'openai-vision']).default('tesseract'),
  fallback: z.enum(['tesseract', 'openai-vision']).optional(),
  tesseract: z.object({
    lang: z.string().default('eng+kor'),
    confidence_threshold: z.number().min(0).max(100).default(70),
  }).optional(),
  manual_fallback: z.boolean().default(true),
});

export const KakaoNotificationSchema = z.object({
  enabled: z.boolean().default(true),
  on_success: z.boolean().default(true),
  on_failure: z.boolean().default(true),
  on_cart_added: z.boolean().default(true),
  mypage_url: z.string().url().optional(),
});

export const NotificationSchema = z.object({
  kakao: KakaoNotificationSchema.optional(),
});

export const BrowserConfigSchema = z.object({
  headless: z.boolean().default(true),
  block_images: z.boolean().default(true),
  block_css: z.boolean().default(true),
  timeout_ms: z.number().default(30000),
});

export const AppConfigSchema = z.object({
  credentials: z.record(z.string(), CredentialsSchema),
  reservations: z.array(ReservationSchema).min(1),
  captcha: CaptchaConfigSchema.optional(),
  notification: NotificationSchema.optional(),
  browser: BrowserConfigSchema.optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
export type TimeSlot = z.infer<typeof TimeSlotSchema>;
export type OpenSchedule = z.infer<typeof OpenScheduleSchema>;
export type RetryConfig = z.infer<typeof RetrySchema>;
export type ReservationForm = z.infer<typeof ReservationFormSchema>;
export type Reservation = z.infer<typeof ReservationSchema>;
export type CaptchaConfig = z.infer<typeof CaptchaConfigSchema>;
export type NotificationConfig = z.infer<typeof NotificationSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
