import cron from 'node-cron';
import type { AppConfig, Reservation } from '../config/schema.js';
import { Booker } from './booker.js';
import { toCronExpression, getNextOpenTime, formatDateTime } from '../utils/time.js';
import { logger } from '../utils/logger.js';

interface ScheduledJob {
  name: string;
  cronExpression: string;
  nextRun: Date;
  task: cron.ScheduledTask;
}

export class Scheduler {
  private config: AppConfig;
  private jobs: ScheduledJob[] = [];

  constructor(config: AppConfig) {
    this.config = config;
  }

  scheduleAll(): void {
    for (const reservation of this.config.reservations) {
      this.scheduleReservation(reservation);
    }

    this.printSchedule();
  }

  scheduleOne(reservationName: string): void {
    const reservation = this.config.reservations.find(r => r.name === reservationName);
    if (!reservation) {
      throw new Error(`예약 "${reservationName}"을 찾을 수 없습니다.`);
    }

    this.scheduleReservation(reservation);
    this.printSchedule();
  }

  private scheduleReservation(reservation: Reservation): void {
    const { open_schedule } = reservation;

    const cronExpr = toCronExpression(
      open_schedule.type,
      open_schedule.time,
      open_schedule.day,
      open_schedule.day_of_week,
    );

    const nextOpenTime = getNextOpenTime(
      open_schedule.type,
      open_schedule.time,
      open_schedule.day,
      open_schedule.day_of_week,
    );

    logger.info(`스케줄 등록: "${reservation.name}" - cron: ${cronExpr}`);

    const task = cron.schedule(cronExpr, async () => {
      logger.info(`=== 스케줄 실행: ${reservation.name} ===`);

      const booker = new Booker(this.config);

      try {
        const result = await booker.executeWithWait(reservation.name);
        logger.info(`결과: ${result.success ? '성공' : '실패'} - ${result.message}`);
      } catch (error) {
        logger.error(`스케줄 실행 오류: ${error}`);
      }
    }, {
      timezone: 'Asia/Seoul',
    });

    this.jobs.push({
      name: reservation.name,
      cronExpression: cronExpr,
      nextRun: nextOpenTime,
      task,
    });
  }

  printSchedule(): void {
    console.log('\n📅 예약 스케줄');
    console.log('─'.repeat(60));

    for (const job of this.jobs) {
      console.log(`  📌 ${job.name}`);
      console.log(`     cron: ${job.cronExpression}`);
      console.log(`     다음 실행: ${formatDateTime(job.nextRun)}`);
      console.log('');
    }

    console.log('─'.repeat(60));
    console.log('스케줄러 실행 중... (Ctrl+C로 종료)\n');
  }

  stop(): void {
    for (const job of this.jobs) {
      job.task.stop();
    }
    this.jobs = [];
    logger.info('모든 스케줄 중지됨');
  }
}
