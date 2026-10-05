import type { AssistReceipt, AssistRequest, EventLog, ExternalUnit, Mission, SearchArea } from './types';

/** 每一单占住的外部力量对搜索区覆盖率的贡献 */
export const EXTERNAL_COVERAGE_WEIGHT = 12;

export function nextNumberedId(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export function windowsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

/**
 * 准入判定：同一外单位、同一时段，占住单数未超容量才放行，否则排队。
 * 两个值班员同时提交同一外单位时，先到的占住、后到的排队，谁也不盖掉谁。
 */
export function admissionFor(unit: ExternalUnit, requests: AssistRequest[], windowStart: string, windowEnd: string): 'held' | 'queued' {
  const concurrent = requests.filter(
    (request) => request.unitId === unit.id && request.status === 'held' && windowsOverlap(request.windowStart, request.windowEnd, windowStart, windowEnd)
  ).length;
  return concurrent < unit.capacity ? 'held' : 'queued';
}

/** 容量空出后，排队单按提交先后顺次补位 */
export function promoteQueued(unitId: string, units: ExternalUnit[], requests: AssistRequest[]): AssistRequest[] {
  const unit = units.find((item) => item.id === unitId);
  if (!unit || unit.status === 'withdrawn') return requests;
  let next = [...requests];
  const waiting = next
    .filter((request) => request.unitId === unitId && request.status === 'queued')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  for (const queued of waiting) {
    if (admissionFor(unit, next, queued.windowStart, queued.windowEnd) === 'held') {
      next = next.map((request) => (request.id === queued.id ? { ...request, status: 'held' as const } : request));
    }
  }
  return next;
}

/** 单位状态由台账推导：撤回的保持撤回，否则有占住单即占用中 */
export function deriveUnitStatus(unit: ExternalUnit, requests: AssistRequest[]): ExternalUnit['status'] {
  if (unit.status === 'withdrawn') return 'withdrawn';
  return requests.some((request) => request.unitId === unit.id && request.status === 'held') ? 'engaged' : 'available';
}

/** 覆盖率 = 基础覆盖率 + 进行中/已派发任务上占住单的协同增益 */
export function recalcAreaCoverage(area: SearchArea, missions: Mission[], requests: AssistRequest[]): number {
  const gain = requests.filter((request) => {
    if (request.status !== 'held') return false;
    const mission = missions.find((item) => item.id === request.missionId);
    return !!mission && mission.areaId === area.id && (mission.status === 'dispatched' || mission.status === 'in_progress');
  }).length * EXTERNAL_COVERAGE_WEIGHT;
  return Math.min(100, Math.max(0, area.baseCoverage + gain));
}

export function recalcAllCoverages(areas: SearchArea[], missions: Mission[], requests: AssistRequest[]): SearchArea[] {
  return areas.map((area) => ({ ...area, coverage: recalcAreaCoverage(area, missions, requests) }));
}

/** 挂起的回执在对应请求编号出现后补入账；同一编号始终只入账一次 */
export function reconcileSuspendedReceipts(
  requests: AssistRequest[],
  receipts: AssistReceipt[]
): { requests: AssistRequest[]; receipts: AssistReceipt[]; resolved: number } {
  const known = new Set(requests.map((request) => request.id));
  let resolved = 0;
  const nextReceipts = receipts.map((receipt) => {
    if (receipt.status === 'suspended' && known.has(receipt.requestId)) {
      resolved += 1;
      return { ...receipt, status: 'posted' as const };
    }
    return receipt;
  });
  if (!resolved) return { requests, receipts, resolved };
  const acknowledgedIds = new Set(nextReceipts.filter((receipt) => receipt.status === 'posted').map((receipt) => receipt.requestId));
  const nextRequests = requests.map((request) => (acknowledgedIds.has(request.id) ? { ...request, acknowledged: true } : request));
  return { requests: nextRequests, receipts: nextReceipts, resolved };
}

const EXTERNAL_NAME_PATTERN = /(渔政|商船|货轮|渔船|拖轮)[0-9A-Za-z·\-一-龥]*/g;

/** 从历史事件文本里提取外部力量称呼 */
export function extractExternalMentions(events: EventLog[]): string[] {
  const names = new Set<string>();
  events.forEach((event) => {
    event.message.match(EXTERNAL_NAME_PATTERN)?.forEach((name) => names.add(name));
  });
  return [...names];
}

function inferUnitKind(name: string): ExternalUnit['kind'] {
  if (name.startsWith('渔政') || name.startsWith('渔船')) return 'fishery';
  if (name.startsWith('商船') || name.startsWith('货轮') || name.startsWith('拖轮')) return 'merchant';
  return 'other';
}

/**
 * 升级回填：旧数据没有外部力量归属，按历史事件把未登记来源补进台账。
 * 事件里同时提到任务的，补一条已释放的历史占用，让旧任务也有据可查。
 */
export function backfillExternalSources(
  input: { externalUnits: ExternalUnit[]; requests: AssistRequest[]; missions: Mission[]; events: EventLog[] },
  startSeq?: number
): { externalUnits: ExternalUnit[]; requests: AssistRequest[]; events: EventLog[]; added: string[] } {
  const known = new Set(input.externalUnits.map((unit) => unit.name));
  const externalUnits = [...input.externalUnits];
  const requests = [...input.requests];
  const events = [...input.events];
  const added: string[] = [];
  let seq = startSeq ?? requests.length;
  extractExternalMentions(input.events)
    .filter((name) => !known.has(name))
    .forEach((name) => {
      const unit: ExternalUnit = {
        id: `ext-backfill-${externalUnits.length + 1}`,
        name,
        kind: inferUnitKind(name),
        capacity: 1,
        status: 'available',
        radioChannel: 'VHF 16',
        source: 'backfill'
      };
      externalUnits.push(unit);
      added.push(name);
      input.events
        .filter((event) => event.message.includes(name))
        .forEach((event) => {
          const mission = input.missions.find((item) => event.message.includes(item.id) || event.message.includes(item.title));
          if (!mission) return;
          seq += 1;
          requests.push({
            id: nextNumberedId('REQ', seq),
            unitId: unit.id,
            missionId: mission.id,
            windowStart: event.time,
            windowEnd: event.time,
            status: 'released',
            acknowledged: true,
            createdBy: '系统回填',
            createdAt: event.time,
            origin: 'backfill'
          });
        });
      events.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '系统', message: `升级回填：按历史事件登记外单位「${name}」` });
    });
  return { externalUnits, requests, events, added };
}

/** v1 → v2 持久化数据升级：补新字段、回填外部来源、重算覆盖率 */
export function upgradeLegacyState(raw: Record<string, any>): Record<string, any> {
  const events: EventLog[] = Array.isArray(raw.events) ? raw.events : [];
  const missions: Mission[] = (Array.isArray(raw.missions) ? raw.missions : []).map((mission: any) => ({
    ...mission,
    status: mission.status === 'draft' ? 'pending' : mission.status,
    closedAt: mission.closedAt ?? (mission.status === 'closed' ? mission.updatedAt : undefined)
  }));
  const areas: SearchArea[] = (Array.isArray(raw.areas) ? raw.areas : []).map((area: any) => ({ ...area, baseCoverage: area.baseCoverage ?? area.coverage ?? 0 }));
  const requests: AssistRequest[] = Array.isArray(raw.requests) ? raw.requests : [];
  const receipts: AssistReceipt[] = Array.isArray(raw.receipts) ? raw.receipts : [];
  const externalUnits: ExternalUnit[] = Array.isArray(raw.externalUnits) ? raw.externalUnits : [];
  const backfilled = backfillExternalSources({ externalUnits, requests, missions, events });
  return {
    ...raw,
    areas: recalcAllCoverages(areas, missions, backfilled.requests),
    missions,
    events: backfilled.events,
    externalUnits: backfilled.externalUnits,
    requests: backfilled.requests,
    receipts,
    requestSeq: backfilled.requests.length,
    receiptSeq: receipts.length
  };
}
