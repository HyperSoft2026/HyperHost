import { checkDatabaseHealth, getPrismaOrThrow } from './database';
import { runtimeRegistry } from '../runtime/registry';
import { logger } from './logger';

export class ControlPlaneScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  public start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    logger.info('Control Plane Cron Scheduler initialized', { intervalMs });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.isTickRunning) return;
    this.isTickRunning = true;

    try {
      const dbHealth = await checkDatabaseHealth();
      if (!dbHealth.connected) {
        return;
      }

      const prisma = getPrismaOrThrow();
      const now = new Date();

      const dueSchedules = await prisma.schedule.findMany({
        where: {
          isActive: true,
          OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }],
        },
        include: {
          host: true,
        },
        take: 25,
      });

      for (const schedule of dueSchedules) {
        const nextRunAt = new Date(now.getTime() + 60 * 60 * 1000);
        const agent = runtimeRegistry.getAgentOrNull(schedule.host.nodeId);

        if (!agent) {
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
              lastStatus: 'SKIPPED_RUNTIME_NODE_UNAVAILABLE',
            },
          });
          continue;
        }

        if (schedule.onlyWhenOnline && schedule.host.status !== 'ONLINE') {
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
              lastStatus: 'SKIPPED_HOST_NOT_ONLINE',
            },
          });
          continue;
        }

        try {
          if (schedule.taskType === 'EXECUTE_COMMAND' && schedule.payload) {
            await agent.processManager.sendStdin(schedule.host.id, schedule.payload);
          } else if (schedule.taskType === 'POWER_STOP') {
            await agent.processManager.stop(schedule.host.id);
          }
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
              lastStatus: 'DISPATCHED_TO_NODE',
            },
          });
        } catch (err) {
          await prisma.schedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt,
              lastStatus: 'EXECUTION_FAILED',
            },
          });
          logger.warn('Scheduled task execution failed', {
            scheduleId: schedule.id,
            hostId: schedule.host.id,
          });
        }
      }
    } catch (err) {
      logger.debug('Scheduler tick skipped', {
        reason: err instanceof Error ? err.message : 'Unknown',
      });
    } finally {
      this.isTickRunning = false;
    }
  }
}

export const controlPlaneScheduler = new ControlPlaneScheduler();
