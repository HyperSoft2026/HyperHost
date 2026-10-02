/**
 * HyperHost Hosting Plans & Resource Limits Engine
 * Powered by HyperSoft
 *
 * Central source of truth for hosting tiers, resource limits, and Host resource snapshots.
 * Enforces strict server-side resource quotas (client input for CPU/RAM/Disk is ignored).
 */
import { getPrismaOrThrow } from './database';
import { logger } from './logger';

export interface HostingPlanDTO {
  id: string;
  code: string;
  name: string;
  description: string;
  cpuLimit: number;
  memoryLimitMb: number;
  storageLimitMb: number;
  maxHosts: number;
  enabled: boolean;
  sortOrder: number;
}

export interface HostResourceSnapshot {
  planId: string | null;
  planCode: string;
  cpuLimit: number;
  memoryLimitMb: number;
  storageLimitMb: number;
}

export const CANONICAL_FREE_PLAN: HostingPlanDTO = {
  id: 'plan_free',
  code: 'FREE',
  name: 'Free Tier',
  description: 'خطة الاستضافة المجانية المخصصة لبوتات وتطبيقات HyperHost الأساسية.',
  cpuLimit: 100,
  memoryLimitMb: 512,
  storageLimitMb: 800,
  maxHosts: 10,
  enabled: true,
  sortOrder: 0,
};

/**
 * Seeds or updates the canonical FREE plan in PostgreSQL on server boot.
 * Safe against pending migrations.
 */
export async function seedHostingPlansIfAvailable(): Promise<void> {
  try {
    const prisma = getPrismaOrThrow();
    if (!('hostingPlan' in prisma)) {
      return;
    }

    await (prisma as any).hostingPlan.upsert({
      where: { code: CANONICAL_FREE_PLAN.code },
      update: {
        name: CANONICAL_FREE_PLAN.name,
        description: CANONICAL_FREE_PLAN.description,
        cpuLimit: CANONICAL_FREE_PLAN.cpuLimit,
        memoryLimitMb: CANONICAL_FREE_PLAN.memoryLimitMb,
        storageLimitMb: CANONICAL_FREE_PLAN.storageLimitMb,
        maxHosts: CANONICAL_FREE_PLAN.maxHosts,
        enabled: true,
        sortOrder: 0,
      },
      create: {
        id: CANONICAL_FREE_PLAN.id,
        code: CANONICAL_FREE_PLAN.code,
        name: CANONICAL_FREE_PLAN.name,
        description: CANONICAL_FREE_PLAN.description,
        cpuLimit: CANONICAL_FREE_PLAN.cpuLimit,
        memoryLimitMb: CANONICAL_FREE_PLAN.memoryLimitMb,
        storageLimitMb: CANONICAL_FREE_PLAN.storageLimitMb,
        maxHosts: CANONICAL_FREE_PLAN.maxHosts,
        enabled: true,
        sortOrder: 0,
      },
    });

    logger.info('Canonical Hosting Plans synchronized successfully');
  } catch (err) {
    logger.warn('HostingPlan table not yet migrated or inaccessible; utilizing canonical fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Retrieves all enabled hosting plans from the database, falling back to CANONICAL_FREE_PLAN.
 */
export async function getAvailableHostingPlans(): Promise<HostingPlanDTO[]> {
  try {
    const prisma = getPrismaOrThrow();
    if ('hostingPlan' in prisma) {
      const records = await (prisma as any).hostingPlan.findMany({
        where: { enabled: true },
        orderBy: { sortOrder: 'asc' },
      });
      if (Array.isArray(records) && records.length > 0) {
        return records.map((p: any) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description || '',
          cpuLimit: p.cpuLimit,
          memoryLimitMb: p.memoryLimitMb,
          storageLimitMb: p.storageLimitMb,
          maxHosts: p.maxHosts,
          enabled: p.enabled,
          sortOrder: p.sortOrder,
        }));
      }
    }
  } catch {
    // Non-fatal fallback
  }

  return [CANONICAL_FREE_PLAN];
}

/**
 * Resolves the canonical resource snapshot for a new Host.
 * STRICT ENFORCEMENT: Client-supplied resource limits are completely disregarded.
 * The plan defines the exact snapshot: CPU, RAM, and Storage.
 */
export async function resolveHostingPlanForHost(
  requestedCodeOrId?: string
): Promise<HostResourceSnapshot> {
  const plans = await getAvailableHostingPlans();
  const normalized = (requestedCodeOrId || 'FREE').trim().toUpperCase();

  const matchedPlan =
    plans.find(
      (p) =>
        p.code.toUpperCase() === normalized ||
        p.id.toLowerCase() === requestedCodeOrId?.trim().toLowerCase()
    ) || plans[0] || CANONICAL_FREE_PLAN;

  return {
    planId: matchedPlan.id,
    planCode: matchedPlan.code,
    cpuLimit: matchedPlan.cpuLimit,
    memoryLimitMb: matchedPlan.memoryLimitMb,
    storageLimitMb: matchedPlan.storageLimitMb,
  };
}
