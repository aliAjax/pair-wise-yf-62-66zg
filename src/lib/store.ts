'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { format } from 'date-fns';
import type {
  AreaStatus,
  AssetStatus,
  AssistReceipt,
  AssistRequest,
  AssistRequestStatus,
  EventLog,
  ExternalUnit,
  ExternalUnitStatus,
  Mission,
  MissionStatus,
  RescueAsset,
  SearchArea
} from './types';
import {
  admissionFor,
  backfillExternalSources,
  deriveUnitStatus,
  nextNumberedId,
  promoteQueued,
  recalcAllCoverages,
  reconcileSuspendedReceipts,
  upgradeLegacyState
} from './ledger';

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const hhmm = (isoString: string) => format(new Date(isoString), 'HH:mm');

const missionStatusLabel: Record<MissionStatus, string> = { pending: '待派', dispatched: '已派发', in_progress: '进行中', closed: '已关闭' };

const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 68, baseCoverage: 68 },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 32, baseCoverage: 32 }
];
const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: iso(now - 35_000) },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: iso(now - 7 * 60_000) },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: iso(now - 18 * 60_000) }
];
const initialMissions: Mission[] = [
  { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: iso(now - 6 * 60_000) },
  { id: 'mission-2', title: 'B区网格预搜', areaId: 'area-b', assetIds: [], status: 'closed', priority: 'normal', note: '预搜完成，待复盘', updatedAt: iso(now - 2 * 3600_000), closedAt: iso(now - 2 * 3600_000) },
  { id: 'mission-3', title: 'B区夜间复搜', areaId: 'area-b', assetIds: [], status: 'pending', priority: 'urgent', note: '等待外部力量时段', updatedAt: iso(now - 50 * 60_000) }
];
const initialExternalUnits: ExternalUnit[] = [
  { id: 'ext-yz3105', name: '渔政3105', kind: 'fishery', capacity: 1, status: 'engaged', radioChannel: 'VHF 16', source: 'manual' },
  { id: 'ext-yy7', name: '商船·远洋7号', kind: 'merchant', capacity: 2, status: 'available', radioChannel: 'VHF 08', source: 'manual' }
];
// REQ-0002 与 REQ-0001 撞了同一时段：容量只有 1 单，先到的占住、后到的排队，不会被盖掉
const initialRequests: AssistRequest[] = [
  { id: 'REQ-0002', unitId: 'ext-yz3105', missionId: 'mission-3', windowStart: iso(now - 30 * 60_000), windowEnd: iso(now + 2 * 3600_000), status: 'queued', acknowledged: false, createdBy: '值班员B', createdAt: iso(now - 20 * 60_000), origin: 'dispatch' },
  { id: 'REQ-0001', unitId: 'ext-yz3105', missionId: 'mission-1', windowStart: iso(now - 3600_000), windowEnd: iso(now + 3 * 3600_000), status: 'held', acknowledged: true, createdBy: '值班员A', createdAt: iso(now - 3600_000), origin: 'dispatch' }
];
const initialReceipts: AssistReceipt[] = [
  { id: 'HJ-0002', requestId: 'REQ-9001', observedAt: iso(now - 25 * 60_000), receivedAt: iso(now - 24 * 60_000), status: 'suspended', timelineOnly: false, note: '请求编号查无记录，挂起对账' },
  { id: 'HJ-0001', requestId: 'REQ-0001', observedAt: iso(now - 40 * 60_000), receivedAt: iso(now - 38 * 60_000), status: 'posted', timelineOnly: false, note: '渔政3105 确认到达A区东侧' }
];
const initialEvents: EventLog[] = [
  { id: 'event-2', time: iso(now - 6 * 60_000), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' },
  { id: 'event-1', time: iso(now - 15 * 60_000), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-5', time: iso(now - 24 * 60_000), actor: '电台', message: '回执 HJ-0002 指向未发出的 REQ-9001，先挂起对账' },
  { id: 'event-4', time: iso(now - 38 * 60_000), actor: '电台', message: '回执 HJ-0001 已入账，REQ-0001 确认' },
  { id: 'event-3', time: iso(now - 3600_000), actor: '值班员A', message: '协同请求 REQ-0001 已占住 渔政3105' },
  { id: 'event-6', time: iso(now - 3 * 3600_000), actor: '值班员', message: '拖轮2068 协助「A区扇形搜索」转运落水人员，未登记在册' }
];
const seededAreas = recalcAllCoverages(initialAreas, initialMissions, initialRequests);

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  externalUnits: ExternalUnit[];
  requests: AssistRequest[];
  receipts: AssistReceipt[];
  requestSeq: number;
  receiptSeq: number;
  offline: boolean;
  lowBandwidth: boolean;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  submitAssistRequest: (input: { unitId: string; missionId: string; windowStart: string; windowEnd: string; createdBy: string }) => void;
  releaseRequest: (id: string, reason?: string) => void;
  postReceipt: (input: { id?: string; requestId: string; observedAt: string; note: string }) => void;
  setExternalUnitStatus: (id: string, status: ExternalUnitStatus) => void;
  reconcileSuspended: () => void;
  runBackfill: () => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set) => ({
      areas: seededAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      externalUnits: initialExternalUnits,
      requests: initialRequests,
      receipts: initialReceipts,
      requestSeq: 2,
      receiptSeq: 2,
      offline: false,
      lowBandwidth: false,
      setAreaStatus: (id, status) => set((state) => ({
        areas: state.areas.map((area) => area.id === id ? { ...area, status } : area),
        events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '指挥员', message: `搜索区 ${id} 状态改为 ${status}` }, ...state.events]
      })),
      setAssetStatus: (id, status) => set((state) => ({
        assets: state.assets.map((asset) => asset.id === id ? { ...asset, status, lastSeen: new Date().toISOString() } : asset),
        events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '值班员', message: `${id} 状态改为 ${status}，已生成恢复记录` }, ...state.events]
      })),
      setMissionStatus: (id, status) => set((state) => {
        const mission = state.missions.find((item) => item.id === id);
        if (!mission) return state;
        const nowIso = new Date().toISOString();
        let requests = state.requests;
        let externalUnits = state.externalUnits;
        let released = 0;
        if (status === 'closed') {
          // 任务关闭时释放其占住的外部时段，排队单顺次补位
          const affectedUnitIds = new Set<string>();
          requests = state.requests.map((request) => {
            if (request.missionId !== id) return request;
            if (request.status === 'held') {
              affectedUnitIds.add(request.unitId);
              released += 1;
              return { ...request, status: 'released' as const };
            }
            if (request.status === 'queued') return { ...request, status: 'cancelled' as const };
            return request;
          });
          affectedUnitIds.forEach((unitId) => { requests = promoteQueued(unitId, externalUnits, requests); });
          externalUnits = externalUnits.map((unit) => ({ ...unit, status: deriveUnitStatus(unit, requests) }));
        }
        const missions = state.missions.map((item) => item.id === id ? { ...item, status, updatedAt: nowIso, closedAt: status === 'closed' ? nowIso : undefined } : item);
        const areas = recalcAllCoverages(state.areas, missions, requests);
        const extra = released ? `，已释放 ${released} 段外部占用` : '';
        return {
          missions,
          requests,
          externalUnits,
          areas,
          events: [{ id: crypto.randomUUID(), time: nowIso, actor: '指挥员', message: `任务「${mission.title}」状态改为 ${missionStatusLabel[status]}${extra}` }, ...state.events]
        };
      }),
      dispatchMission: (input) => set((state) => {
        const mission: Mission = { id: crypto.randomUUID(), ...input, status: 'dispatched', updatedAt: new Date().toISOString() };
        return {
          missions: [mission, ...state.missions],
          assets: state.assets.map((asset) => input.assetIds.includes(asset.id) ? { ...asset, status: 'assigned' } : asset),
          events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '指挥员', message: `任务“${input.title}”已派发` }, ...state.events]
        };
      }),
      submitAssistRequest: (input) => set((state) => {
        const unit = state.externalUnits.find((item) => item.id === input.unitId);
        const mission = state.missions.find((item) => item.id === input.missionId);
        if (!unit || !mission) return state;
        const nowIso = new Date().toISOString();
        const seq = state.requestSeq + 1;
        const id = nextNumberedId('REQ', seq);
        let status: AssistRequestStatus = 'cancelled';
        let message: string;
        if (unit.status === 'withdrawn') {
          message = `协同请求 ${id} 未放行：${unit.name} 已撤回`;
        } else if (mission.status === 'closed') {
          message = `协同请求 ${id} 未放行：任务「${mission.title}」已关闭`;
        } else {
          // 同一外单位同一时段只放行 capacity 单；后到的请求排队，不盖掉先前那单
          status = admissionFor(unit, state.requests, input.windowStart, input.windowEnd);
          message = status === 'held'
            ? `协同请求 ${id} 已占住 ${unit.name}（${hhmm(input.windowStart)}–${hhmm(input.windowEnd)}）`
            : `协同请求 ${id} 超出 ${unit.name} 同时段容量，已排队等待补位`;
        }
        const request: AssistRequest = {
          id,
          unitId: unit.id,
          missionId: mission.id,
          windowStart: input.windowStart,
          windowEnd: input.windowEnd,
          status,
          acknowledged: false,
          createdBy: input.createdBy,
          createdAt: nowIso,
          origin: 'dispatch'
        };
        let requests = [request, ...state.requests];
        let missions = state.missions;
        if (status === 'held' && mission.status === 'pending') {
          missions = state.missions.map((item) => item.id === mission.id ? { ...item, status: 'dispatched' as const, updatedAt: nowIso } : item);
        }
        const externalUnits = state.externalUnits.map((item) => item.id === unit.id ? { ...item, status: deriveUnitStatus(item, requests) } : item);
        // 新编号若恰好对上挂起的回执，立即对账入账
        const reconciled = reconcileSuspendedReceipts(requests, state.receipts);
        requests = reconciled.requests;
        const events: EventLog[] = [{ id: crypto.randomUUID(), time: nowIso, actor: input.createdBy, message }];
        if (reconciled.resolved) {
          events.push({ id: crypto.randomUUID(), time: nowIso, actor: '电台', message: `挂起回执对账完成，${reconciled.resolved} 条入账` });
        }
        const areas = recalcAllCoverages(state.areas, missions, requests);
        return { requests, missions, externalUnits, receipts: reconciled.receipts, areas, requestSeq: seq, events: [...events, ...state.events] };
      }),
      releaseRequest: (id, reason) => set((state) => {
        const target = state.requests.find((item) => item.id === id);
        if (!target || (target.status !== 'held' && target.status !== 'queued')) return state;
        const nowIso = new Date().toISOString();
        let requests = state.requests.map((item) => item.id === id ? { ...item, status: 'released' as const } : item);
        requests = promoteQueued(target.unitId, state.externalUnits, requests);
        const externalUnits = state.externalUnits.map((item) => item.id === target.unitId ? { ...item, status: deriveUnitStatus(item, requests) } : item);
        const areas = recalcAllCoverages(state.areas, state.missions, requests);
        return {
          requests,
          externalUnits,
          areas,
          events: [{ id: crypto.randomUUID(), time: nowIso, actor: '值班员', message: `协同请求 ${id} 已释放${reason ? `（${reason}）` : ''}，排队单顺次补位，覆盖率已重算` }, ...state.events]
        };
      }),
      postReceipt: (input) => set((state) => {
        const nowIso = new Date().toISOString();
        const seq = state.receiptSeq + 1;
        const id = input.id?.trim() || nextNumberedId('HJ', seq);
        // 同一回执编号只入账一次，重复送达直接留痕忽略
        if (state.receipts.some((item) => item.id === id)) {
          return { events: [{ id: crypto.randomUUID(), time: nowIso, actor: '电台', message: `回执 ${id} 重复送达，该编号已入账，不再重复记账` }, ...state.events] };
        }
        const request = state.requests.find((item) => item.id === input.requestId);
        // 没发过的请求编号：回执先挂起对账
        if (!request) {
          const receipt: AssistReceipt = { id, requestId: input.requestId, observedAt: input.observedAt, receivedAt: nowIso, status: 'suspended', timelineOnly: false, note: input.note };
          return {
            receipts: [receipt, ...state.receipts],
            receiptSeq: seq,
            events: [{ id: crypto.randomUUID(), time: nowIso, actor: '电台', message: `回执 ${id} 指向未发出的 ${input.requestId}，先挂起对账` }, ...state.events]
          };
        }
        const mission = state.missions.find((item) => item.id === request.missionId);
        const timelineOnly = !!mission && mission.status === 'closed' && !!mission.closedAt && new Date(input.observedAt).getTime() < new Date(mission.closedAt).getTime();
        const receipt: AssistReceipt = { id, requestId: request.id, observedAt: input.observedAt, receivedAt: nowIso, status: 'posted', timelineOnly, note: input.note };
        let missions = state.missions;
        let message: string;
        if (mission && mission.status === 'closed') {
          // 任务已关闭的回执只补进时间线，绝不重开任务
          message = timelineOnly
            ? `回执 ${id} 观测时刻早于任务关闭，仅补入时间线，任务保持关闭`
            : `回执 ${id} 入账；任务已关闭，仅留痕不重开`;
        } else {
          if (mission && mission.status === 'dispatched') {
            missions = state.missions.map((item) => item.id === mission.id ? { ...item, status: 'in_progress' as const, updatedAt: nowIso } : item);
          }
          message = `回执 ${id} 已入账，${request.id} 确认`;
        }
        const requests = state.requests.map((item) => item.id === request.id ? { ...item, acknowledged: true } : item);
        const areas = recalcAllCoverages(state.areas, missions, requests);
        return {
          receipts: [receipt, ...state.receipts],
          receiptSeq: seq,
          requests,
          missions,
          areas,
          events: [{ id: crypto.randomUUID(), time: nowIso, actor: '电台', message }, ...state.events]
        };
      }),
      setExternalUnitStatus: (id, status) => set((state) => {
        const unit = state.externalUnits.find((item) => item.id === id);
        if (!unit || unit.status === status) return state;
        const nowIso = new Date().toISOString();
        if (status === 'withdrawn') {
          // 外单位撤回：占用单全部取消，相关任务退回待派，覆盖率重算
          const affected = state.requests.filter((item) => item.unitId === id && (item.status === 'held' || item.status === 'queued'));
          const requests = state.requests.map((item) => affected.some((entry) => entry.id === item.id) ? { ...item, status: 'cancelled' as const } : item);
          const missionIds = new Set(affected.filter((item) => item.status === 'held').map((item) => item.missionId));
          const missions = state.missions.map((item) =>
            missionIds.has(item.id) && (item.status === 'dispatched' || item.status === 'in_progress') ? { ...item, status: 'pending' as const, updatedAt: nowIso } : item
          );
          const externalUnits = state.externalUnits.map((item) => item.id === id ? { ...item, status: 'withdrawn' as const } : item);
          const areas = recalcAllCoverages(state.areas, missions, requests);
          return {
            requests,
            missions,
            externalUnits,
            areas,
            events: [{ id: crypto.randomUUID(), time: nowIso, actor: '值班员', message: `${unit.name} 状态变化（撤回）：${affected.length} 单取消，相关任务退回待派，覆盖率已重算` }, ...state.events]
          };
        }
        const externalUnits = state.externalUnits.map((item) => item.id === id ? { ...item, status: deriveUnitStatus({ ...item, status }, state.requests) } : item);
        return {
          externalUnits,
          events: [{ id: crypto.randomUUID(), time: nowIso, actor: '值班员', message: `${unit.name} 恢复可协同，可重新发请求占住时段` }, ...state.events]
        };
      }),
      reconcileSuspended: () => set((state) => {
        const reconciled = reconcileSuspendedReceipts(state.requests, state.receipts);
        if (!reconciled.resolved) return state;
        return {
          requests: reconciled.requests,
          receipts: reconciled.receipts,
          events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '电台', message: `挂起回执对账完成，${reconciled.resolved} 条入账` }, ...state.events]
        };
      }),
      runBackfill: () => set((state) => {
        const result = backfillExternalSources(
          { externalUnits: state.externalUnits, requests: state.requests, missions: state.missions, events: state.events },
          state.requestSeq
        );
        if (!result.added.length) {
          return { events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '系统', message: '回填检查：未发现未登记的外部来源' }, ...state.events] };
        }
        const reconciled = reconcileSuspendedReceipts(result.requests, state.receipts);
        return {
          externalUnits: result.externalUnits,
          requests: reconciled.requests,
          receipts: reconciled.receipts,
          events: result.events,
          requestSeq: state.requestSeq + (result.requests.length - state.requests.length)
        };
      }),
      toggleOffline: () => set((state) => ({ offline: !state.offline })),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth }))
    }),
    {
      name: 'maritime-command-v1',
      version: 2,
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as CommandState;
        // 旧数据没有外部力量归属：升级时按历史事件回填未登记来源
        return upgradeLegacyState(persisted as Record<string, unknown>) as unknown as CommandState;
      }
    }
  )
);
