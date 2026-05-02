/**
 * Antigravity Cockpit - Scheduler Service
 *
 */

import { ScheduleConfig, CrontabParseResult } from './types';
import { CronExpressionParser } from 'cron-parser';
import { logger } from '../shared/log_service';
import { t } from '../shared/i18n';

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const LOCAL_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * Cron
 *
 */
class CronParser {
    /**
     *
     */
    static configToCrontab(config: ScheduleConfig): string {
        switch (config.repeatMode) {
            case 'daily':
                return this.dailyToCrontab(config.dailyTimes || []);
            case 'weekly':
                return this.weeklyToCrontab(config.weeklyDays || [], config.weeklyTimes || []);
            case 'interval':
                return this.intervalToCrontab(
                    config.intervalHours || 4,
                    config.intervalStartTime || '00:00',
                    config.intervalEndTime,
                );
            default:
                return '0 8 * * *';
        }
    }

    /**
     *
     *
     *
     */
    private static dailyToCrontab(times: string[]): string {
        if (times.length === 0) {
            return '0 8 * * *';
        }

        const minuteGroups = new Map<number, number[]>();
        for (const time of times) {
            const [h, m] = time.split(':').map(Number);
            if (!minuteGroups.has(m)) {
                minuteGroups.set(m, []);
            }
            minuteGroups.get(m)!.push(h);
        }


        const expressions: string[] = [];
        for (const [minute, hours] of minuteGroups) {
            const hourList = hours.sort((a, b) => a - b).join(',');
            expressions.push(`${minute} ${hourList} * * *`);
        }

        return expressions.join(';');
    }

    /**
     *
     *
     *
     */
    private static weeklyToCrontab(days: number[], times: string[]): string {
        if (days.length === 0 || times.length === 0) {
            return '0 8 * * 1-5';
        }

        const sortedDays = [...days].sort((a, b) => a - b);
        let dayExpr: string;

        if (this.isConsecutive(sortedDays)) {
            dayExpr = `${sortedDays[0]}-${sortedDays[sortedDays.length - 1]}`;
        } else {
            dayExpr = sortedDays.join(',');
        }

        const minuteGroups = new Map<number, number[]>();
        for (const time of times) {
            const [h, m] = time.split(':').map(Number);
            if (!minuteGroups.has(m)) {
                minuteGroups.set(m, []);
            }
            minuteGroups.get(m)!.push(h);
        }


        const expressions: string[] = [];
        for (const [minute, hours] of minuteGroups) {
            const hourList = hours.sort((a, b) => a - b).join(',');
            expressions.push(`${minute} ${hourList} * * ${dayExpr}`);
        }

        return expressions.join(';');
    }

    /**
     *
     *
     */
    private static intervalToCrontab(
        intervalHours: number,
        startTime: string,
        endTime?: string,
    ): string {
        const [startH, startM] = startTime.split(':').map(Number);
        const endH = endTime ? parseInt(endTime.split(':')[0], 10) : 23;

        const hours: number[] = [];
        for (let h = startH; h <= endH; h += intervalHours) {
            hours.push(h);
        }

        if (hours.length === 0) {
            hours.push(startH);
        }

        return `${startM} ${hours.join(',')} * * *`;
    }

    /**
     *
     */
    private static isConsecutive(arr: number[]): boolean {
        if (arr.length <= 1) {return true;}
        for (let i = 1; i < arr.length; i++) {
            if (arr[i] !== arr[i - 1] + 1) {
                return false;
            }
        }
        return true;
    }

    /**
     *
     */
    static parse(crontab: string): CrontabParseResult {
        try {
            const expressions = crontab.split(';').filter(e => e.trim());
            
            if (expressions.length === 0) {
                return {
                    valid: false,
                    error: 'Invalid crontab format',
                };
            }

            const allDescriptions: string[] = [];
            
            for (const expr of expressions) {
                const parts = expr.trim().split(/\s+/);
                if (parts.length !== 5) {
                    return {
                        valid: false,
                        error: 'Invalid crontab format, requires 5 fields',
                    };
                }

                const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
                const desc = this.generateDescription(minute, hour, dayOfMonth, month, dayOfWeek);
                allDescriptions.push(desc);
            }

            const nextRuns = this.getNextRuns(crontab, 5);

            const uniqueDescs = [...new Set(allDescriptions)];
            const description = uniqueDescs.length === 1 
                ? uniqueDescs[0]
                : uniqueDescs.join(', ');

            return {
                valid: true,
                description,
                nextRuns,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            return {
                valid: false,
                error: err.message,
            };
        }
    }

    /**
     *
     */
    private static generateDescription(
        minute: string,
        hour: string,
        dayOfMonth: string,
        month: string,
        dayOfWeek: string,
    ): string {
        if (dayOfMonth !== '*' || month !== '*') {
            return t('autoTrigger.desc.custom');
        }

        if (minute.includes('/') || hour.includes('/') || dayOfWeek.includes('/')) {
            return t('autoTrigger.desc.custom');
        }

        const parts: string[] = [];

        if (minute === '0' && hour === '*') {
            parts.push(t('autoTrigger.desc.hourly'));
        } else if (hour.includes(',')) {

            const hours = hour.split(',');
            const min = minute.padStart(2, '0');
            const timeList = hours.map(h => `${h.padStart(2, '0')}:${min}`).join(', ');
            parts.push(t('autoTrigger.desc.dailyAt', { times: timeList }));
        } else if (hour !== '*' && minute !== '*') {

            const timeStr = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
            parts.push(t('autoTrigger.desc.dailyAt', { times: timeStr }));
        }

        if (dayOfWeek !== '*') {
            const dayNames = [
                t('common.weekday.sun'), t('common.weekday.mon'), t('common.weekday.tue'), 
                t('common.weekday.wed'), t('common.weekday.thu'), t('common.weekday.fri'), 
                t('common.weekday.sat'),
            ];
            if (dayOfWeek === '1-5') {
                parts.push(t('autoTrigger.desc.workday'));
            } else if (dayOfWeek === '0,6' || dayOfWeek === '6,0') {
                parts.push(t('autoTrigger.desc.weekend'));
            } else {
                const days = this.expandField(dayOfWeek, 0, 6).map(d => dayNames[d]);
                parts.push(days.join(', '));
            }
        }

        return parts.join(' ') || t('autoTrigger.desc.custom');
    }

    /**
     *
     */
    private static expandField(field: string, min: number, max: number): number[] {
        if (field === '*') {
            return Array.from({ length: max - min + 1 }, (_, i) => min + i);
        }

        const result: number[] = [];

        for (const part of field.split(',')) {
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(Number);
                for (let i = start; i <= end; i++) {
                    result.push(i);
                }
            } else if (part.startsWith('*/')) {
                const step = parseInt(part.slice(2), 10);
                for (let i = min; i <= max; i += step) {
                    result.push(i);
                }
            } else {
                result.push(parseInt(part, 10));
            }
        }

        return [...new Set(result)].sort((a, b) => a - b);
    }

    /**
     *
     *
     */
    static getNextRuns(crontab: string, count: number): Date[] {
        try {
            const expressions = crontab.split(';').filter(e => e.trim());
            const allDates: Date[] = [];

            for (const expr of expressions) {
                const interval = CronExpressionParser.parse(expr.trim(), {
                    currentDate: new Date(),
                    tz: LOCAL_TIMEZONE,
                });

                for (let i = 0; i < count; i++) {
                    allDates.push(interval.next().toDate());
                }
            }

            const uniqueDates = Array.from(
                new Map(allDates.map(d => [d.getTime(), d])).values(),
            );
            uniqueDates.sort((a, b) => a.getTime() - b.getTime());

            return uniqueDates.slice(0, count);
        } catch {
            return [];
        }
    }
}

/**
 *
 */
class SchedulerService {
    private timer?: ReturnType<typeof setTimeout>;
    private schedule?: ScheduleConfig;
    private onTrigger?: () => Promise<void>;

    /**
     *
     */
    setSchedule(config: ScheduleConfig, onTrigger: () => Promise<void>): void {
        this.schedule = config;
        this.onTrigger = onTrigger;

        if (config.enabled) {
            this.start();
        } else {
            this.stop();
        }
    }

    /**
     *
     */
    start(): void {
        if (!this.schedule || !this.onTrigger) {
            logger.warn('[SchedulerService] Cannot start: no schedule or trigger handler');
            return;
        }

        if (this.timer) {
            logger.info('[SchedulerService] Scheduler already running, restarting...');
            this.stop();
        }

        this.scheduleNextRun();
        logger.info('[SchedulerService] Scheduler started');
    }

    /**
     *
     */
    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        logger.info('[SchedulerService] Scheduler stopped');
    }

    /**
     *
     */
    getNextRunTime(): Date | null {
        if (!this.schedule || !this.schedule.enabled) {
            return null;
        }

        const crontab = this.schedule.crontab || CronParser.configToCrontab(this.schedule);
        const nextRuns = CronParser.getNextRuns(crontab, 1);
        return nextRuns.length > 0 ? nextRuns[0] : null;
    }

    /**
     *
     */
    describeSchedule(config: ScheduleConfig): string {
        const crontab = config.crontab || CronParser.configToCrontab(config);
        const result = CronParser.parse(crontab);
        return result.description || crontab;
    }

    /**
     *
     */
    validateCrontab(crontab: string): CrontabParseResult {
        return CronParser.parse(crontab);
    }

    /**
     *
     */
    configToCrontab(config: ScheduleConfig): string {
        return CronParser.configToCrontab(config);
    }

    /**
     *
     */
    private scheduleNextRun(): void {
        if (!this.schedule || !this.onTrigger) {return;}

        const nextRun = this.getNextRunTime();
        if (!nextRun) {
            logger.warn('[SchedulerService] No next run time calculated');
            return;
        }

        const delay = nextRun.getTime() - Date.now();
        if (delay < 0) {
            this.timer = setTimeout(() => this.scheduleNextRun(), 60000);
            return;
        }

        if (delay > MAX_TIMER_DELAY_MS) {
            logger.info('[SchedulerService] Next run is far in the future; scheduling a checkpoint.');
            this.timer = setTimeout(() => this.scheduleNextRun(), MAX_TIMER_DELAY_MS);
            return;
        }

        logger.info(`[SchedulerService] Next run scheduled at ${nextRun.toLocaleString()} (in ${Math.round(delay / 60000)} minutes)`);

        this.timer = setTimeout(async () => {
            try {
                logger.info('[SchedulerService] Executing scheduled trigger');
                await this.onTrigger!();
            } catch (error) {
                const err = error instanceof Error ? error : new Error(String(error));
                logger.error(`[SchedulerService] Trigger failed: ${err.message}`);
            }

            if (this.schedule && this.schedule.enabled) {
                this.scheduleNextRun();
            } else {
                logger.info('[SchedulerService] Schedule disabled, stopping loop');
                this.timer = undefined;
            }
        }, delay);
    }
}

export const schedulerService = new SchedulerService();
export { CronParser };
