'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AreaStatus,
  AssetStatus,
  CoordRequest,
  CoordRequestStatus,
  EventLog,
  ExternalUnit,
  ExternalUnitStatus,
  ExternalUnitType,
  Mission,
  MissionStatus,
  Receipt,
  RescueAsset,
  SearchArea
} from './types';

const now = Date.now();
const initialAreas: SearchArea[] = [
  { id: 'area-a', name: 'A区 · 最后目击点', bounds: [121.42, 30.65, 121.68, 30.88], status: 'active', coverage: 65 },
  { id: 'area-b', name: 'B区 · 北向漂流', bounds: [121.64, 30.82, 121.96, 31.06], status: 'planned', coverage: 15 }
];
const initialAssets: RescueAsset[] = [
  { id: 'ship-01', name: '海巡071', type: 'ship', status: 'assigned', lat: 30.75, lng: 121.55, lastSeen: new Date(now - 35_000).toISOString() },
  { id: 'heli-02', name: '救助B-712', type: 'helicopter', status: 'ready', lat: 30.82, lng: 121.73, lastSeen: new Date(now - 7 * 60_000).toISOString() },
  { id: 'drone-03', name: '无人机D-9', type: 'drone', status: 'offline', lat: 30.69, lng: 121.61, lastSeen: new Date(now - 18 * 60_000).toISOString() }
];
const initialMissions: Mission[] = [
  { id: 'mission-1', title: 'A区扇形搜索', areaId: 'area-a', assetIds: ['ship-01', 'drone-03'], status: 'in_progress', priority: 'urgent', note: '优先核验橙色漂浮物', updatedAt: new Date(now - 6 * 60_000).toISOString() }
];
const initialEvents: EventLog[] = [
  { id: 'event-1', time: new Date(now - 15 * 60_000).toISOString(), actor: '指挥员', message: 'A区任务下发，海巡071开始扇形搜索' },
  { id: 'event-2', time: new Date(now - 6 * 60_000).toISOString(), actor: '无人机D-9', message: '链路中断，最后位置已标记为过期' },
  { id: 'event-3', time: new Date(now - 2 * 60 * 60_000).toISOString(), actor: '值班员', message: '历史协同一览表记录：渔政33102 曾在A区东缘协助瞭望' }
];
const initialExternalUnits: ExternalUnit[] = [
  { id: 'ext-fishery-33001', name: '渔政33001', type: 'fishery', capacity: 1, status: 'available', contact: 'VHF 16频道', source: 'registered' },
  { id: 'ext-merchant-zhedai68', name: '商船浙岱渔运68', type: 'merchant', capacity: 1, status: 'available', contact: 'VHF 08频道', source: 'registered' }
];

// 时段重叠判断（ISO 字符串可直接按字典序比较）
function overlaps(startA: string, endA: string, startB: string, endB: string): boolean {
  return startA < endB && startB < endA;
}

const ASSET_WEIGHT: Record<RescueAsset['type'], number> = { ship: 15, helicopter: 20, drone: 10, shore: 5 };
const UNIT_WEIGHT: Record<ExternalUnitType, number> = { fishery: 12, merchant: 8, other: 6 };

// 重算各搜索区覆盖率：本单位已派力量 + 已放行的外部协同力量
function recomputeCoverage(
  areas: SearchArea[],
  assets: RescueAsset[],
  missions: Mission[],
  requests: CoordRequest[],
  externalUnits: ExternalUnit[]
): SearchArea[] {
  return areas.map((area) => {
    let coverage = area.status === 'closed' ? 100 : area.status === 'active' ? 40 : 15;
    const areaMissions = missions.filter((m) => m.areaId === area.id && m.status !== 'closed');
    const assignedAssetIds = new Set(areaMissions.flatMap((m) => m.assetIds));
    for (const asset of assets) {
      if (assignedAssetIds.has(asset.id)) coverage += ASSET_WEIGHT[asset.type] ?? 8;
    }
    const areaMissionIds = new Set(areaMissions.map((m) => m.id));
    for (const req of requests) {
      if (req.status !== 'confirmed' && req.status !== 'released') continue;
      if (!areaMissionIds.has(req.missionId)) continue;
      const unit = externalUnits.find((u) => u.id === req.externalUnitId);
      if (unit) coverage += UNIT_WEIGHT[unit.type] ?? 6;
    }
    return { ...area, coverage: Math.min(100, Math.round(coverage)) };
  });
}

// 从历史事件文本中抽取外部力量来源
function extractExternalSources(message: string): { name: string; type: ExternalUnitType }[] {
  const results: { name: string; type: ExternalUnitType }[] = [];
  const fishery = message.match(/渔政[\w-]+/g);
  if (fishery) fishery.forEach((name) => results.push({ name, type: 'fishery' }));
  const merchant = message.match(/商船[“"]?[\w一-龥-]+[”"]?/g);
  if (merchant) merchant.forEach((raw) => results.push({ name: raw.replace(/[“”"]/g, ''), type: 'merchant' }));
  return results;
}

// 按历史事件回填未登记的外部力量来源
function backfillFromEvents(
  events: EventLog[],
  existingUnits: ExternalUnit[]
): { units: ExternalUnit[]; added: string[] } {
  const knownNames = new Set(existingUnits.map((u) => u.name));
  const units: ExternalUnit[] = [];
  const added: string[] = [];
  for (const event of events) {
    for (const source of extractExternalSources(event.message)) {
      if (knownNames.has(source.name)) continue;
      if (units.some((u) => u.name === source.name)) continue;
      units.push({
        id: `ext-backfill-${source.name}-${crypto.randomUUID().slice(0, 8)}`,
        name: source.name,
        type: source.type,
        capacity: 1,
        status: 'available',
        contact: '历史事件回填',
        source: 'backfilled'
      });
      added.push(source.name);
      knownNames.add(source.name);
    }
  }
  return { units, added };
}

const OPEN_REQUEST_STATUSES: CoordRequestStatus[] = ['queued', 'confirmed', 'released'];

interface CommandState {
  areas: SearchArea[];
  assets: RescueAsset[];
  missions: Mission[];
  events: EventLog[];
  externalUnits: ExternalUnit[];
  coordRequests: CoordRequest[];
  receipts: Receipt[];
  requestSeq: number;
  offline: boolean;
  lowBandwidth: boolean;
  setAreaStatus: (id: string, status: AreaStatus) => void;
  setAssetStatus: (id: string, status: AssetStatus) => void;
  setMissionStatus: (id: string, status: MissionStatus) => void;
  dispatchMission: (input: { title: string; areaId: string; assetIds: string[]; priority: 'normal' | 'urgent'; note: string }) => void;
  toggleOffline: () => void;
  toggleBandwidth: () => void;
  addExternalUnit: (input: { name: string; type: ExternalUnitType; capacity: number; contact: string }) => void;
  setExternalUnitStatus: (id: string, status: ExternalUnitStatus) => void;
  withdrawExternalUnit: (id: string) => void;
  createCoordRequest: (input: { missionId: string; externalUnitId: string; start: string; end: string }) => void;
  cancelCoordRequest: (id: string) => void;
  submitReceipt: (input: { requestCode: string; observedAt: string; content: string }) => void;
  reconcileReceipt: (id: string) => void;
  backfillFromHistory: () => void;
}

export const useCommandStore = create<CommandState>()(
  persist(
    (set) => ({
      areas: initialAreas,
      assets: initialAssets,
      missions: initialMissions,
      events: initialEvents,
      externalUnits: initialExternalUnits,
      coordRequests: [],
      receipts: [],
      requestSeq: 0,
      offline: false,
      lowBandwidth: false,
      setAreaStatus: (id, status) => set((state) => ({
        areas: recomputeCoverage(
          state.areas.map((area) => area.id === id ? { ...area, status } : area),
          state.assets,
          state.missions,
          state.coordRequests,
          state.externalUnits
        ),
        events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '指挥员', message: `搜索区 ${id} 状态改为 ${status}` }, ...state.events]
      })),
      setAssetStatus: (id, status) => set((state) => ({
        assets: state.assets.map((asset) => asset.id === id ? { ...asset, status, lastSeen: new Date().toISOString() } : asset),
        events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '值班员', message: `${id} 状态改为 ${status}，已生成恢复记录` }, ...state.events]
      })),
      setMissionStatus: (id, status) => set((state) => {
        const now = new Date().toISOString();
        const missions = state.missions.map((mission) => mission.id === id
          ? { ...mission, status, updatedAt: now, closedAt: status === 'closed' ? now : undefined }
          : mission);
        return {
          missions,
          areas: recomputeCoverage(state.areas, state.assets, missions, state.coordRequests, state.externalUnits),
          events: [{ id: crypto.randomUUID(), time: now, actor: '指挥员', message: `任务 ${id} 状态改为 ${status}` }, ...state.events]
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
      toggleOffline: () => set((state) => ({ offline: !state.offline })),
      toggleBandwidth: () => set((state) => ({ lowBandwidth: !state.lowBandwidth })),

      addExternalUnit: (input) => set((state) => {
        const unit: ExternalUnit = { id: crypto.randomUUID(), ...input, status: 'available', source: 'registered' };
        return {
          externalUnits: [...state.externalUnits, unit],
          events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '指挥员', message: `外部力量 ${unit.name} 已登记入协同账` }, ...state.events]
        };
      }),

      setExternalUnitStatus: (id, status) => set((state) => {
        const unit = state.externalUnits.find((u) => u.id === id);
        if (!unit) return state;
        const now = new Date().toISOString();
        const unitRequests = state.coordRequests.filter((r) => r.externalUnitId === id && OPEN_REQUEST_STATUSES.includes(r.status));
        const affectedMissionIds = new Set(unitRequests.map((r) => r.missionId));
        const events: EventLog[] = [{ id: crypto.randomUUID(), time: now, actor: '值班员', message: `外部力量 ${unit.name} 状态改为 ${status}` }];

        let requests = state.coordRequests;
        let missions = state.missions;
        if (status === 'withdrawn') {
          // 撤回：占住的时段全部释放，关联任务退回待派
          requests = state.coordRequests.map((r) => unitRequests.some((ur) => ur.id === r.id) ? { ...r, status: 'withdrawn' as const } : r);
          events.push({ id: crypto.randomUUID(), time: now, actor: '指挥员', message: `外部力量 ${unit.name} 撤回，已占时段释放` });
        }
        if (status === 'withdrawn' || status === 'busy') {
          missions = state.missions.map((m) => affectedMissionIds.has(m.id) && m.status !== 'closed'
            ? { ...m, status: 'pending_dispatch' as const, updatedAt: now }
            : m);
          if (affectedMissionIds.size > 0) {
            events.push({ id: crypto.randomUUID(), time: now, actor: '指挥员', message: `${affectedMissionIds.size} 个关联任务退回待派，覆盖率重算` });
          }
        }

        const externalUnits = state.externalUnits.map((u) => u.id === id ? { ...u, status } : u);
        return {
          externalUnits,
          missions,
          coordRequests: requests,
          areas: recomputeCoverage(state.areas, state.assets, missions, requests, externalUnits),
          events: [...events, ...state.events]
        };
      }),

      withdrawExternalUnit: (id) => set((state) => {
        const unit = state.externalUnits.find((u) => u.id === id);
        if (!unit) return state;
        const now = new Date().toISOString();
        const unitRequests = state.coordRequests.filter((r) => r.externalUnitId === id && OPEN_REQUEST_STATUSES.includes(r.status));
        const affectedMissionIds = new Set(unitRequests.map((r) => r.missionId));
        const requests = state.coordRequests.map((r) => unitRequests.some((ur) => ur.id === r.id) ? { ...r, status: 'withdrawn' as const } : r);
        const missions = state.missions.map((m) => affectedMissionIds.has(m.id) && m.status !== 'closed'
          ? { ...m, status: 'pending_dispatch' as const, updatedAt: now }
          : m);
        const externalUnits = state.externalUnits.map((u) => u.id === id ? { ...u, status: 'withdrawn' as const } : u);
        const events: EventLog[] = [
          { id: crypto.randomUUID(), time: now, actor: '指挥员', message: `外部力量 ${unit.name} 撤回，已占时段释放` },
          ...(affectedMissionIds.size > 0 ? [{ id: crypto.randomUUID(), time: now, actor: '指挥员', message: `${affectedMissionIds.size} 个关联任务退回待派，覆盖率重算` }] : [])
        ];
        return {
          externalUnits,
          missions,
          coordRequests: requests,
          areas: recomputeCoverage(state.areas, state.assets, missions, requests, externalUnits),
          events: [...events, ...state.events]
        };
      }),

      createCoordRequest: (input) => set((state) => {
        const unit = state.externalUnits.find((u) => u.id === input.externalUnitId);
        if (!unit) return state;
        const now = new Date().toISOString();
        const code = `XQ-${String(state.requestSeq + 1).padStart(4, '0')}`;
        const confirmedOverlap = state.coordRequests.filter((r) =>
          r.externalUnitId === input.externalUnitId &&
          r.status === 'confirmed' &&
          overlaps(r.start, r.end, input.start, input.end)
        ).length;
        const queued = unit.status === 'withdrawn' || confirmedOverlap >= unit.capacity;
        const request: CoordRequest = {
          id: code,
          missionId: input.missionId,
          externalUnitId: input.externalUnitId,
          start: input.start,
          end: input.end,
          status: queued ? 'queued' : 'confirmed',
          createdAt: now
        };
        const mission = state.missions.find((m) => m.id === input.missionId);
        const events: EventLog[] = [{
          id: crypto.randomUUID(),
          time: now,
          actor: '值班员',
          message: queued
            ? `协同请求 ${code} 超出 ${unit.name} 容量（同时段已占 ${confirmedOverlap} 单），已排队`
            : `协同请求 ${code} 已按编号占住 ${unit.name} 时段 ${input.start.slice(11, 16)}–${input.end.slice(11, 16)}（放行）`
        }];
        let missions = state.missions;
        if (!queued && mission?.status === 'pending_dispatch') {
          missions = state.missions.map((m) => m.id === input.missionId ? { ...m, status: 'dispatched' as const, updatedAt: now } : m);
          events.push({ id: crypto.randomUUID(), time: now, actor: '指挥员', message: `任务 ${mission.id} 待派解除，重新派发` });
        }
        const requests = [...state.coordRequests, request];
        return {
          coordRequests: requests,
          requestSeq: state.requestSeq + 1,
          missions,
          areas: recomputeCoverage(state.areas, state.assets, missions, requests, state.externalUnits),
          events: [...events, ...state.events]
        };
      }),

      cancelCoordRequest: (id) => set((state) => {
        const req = state.coordRequests.find((r) => r.id === id);
        if (!req || req.status === 'withdrawn') return state;
        const now = new Date().toISOString();
        let requests = state.coordRequests.map((r) => r.id === id ? { ...r, status: 'withdrawn' as const } : r);
        // 释放时段后，排队中最早一单递进放行
        const queued = requests
          .filter((r) => r.externalUnitId === req.externalUnitId && r.status === 'queued')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        let missions = state.missions;
        if (queued.length > 0) {
          const promote = queued[0];
          requests = requests.map((r) => r.id === promote.id ? { ...r, status: 'confirmed' as const } : r);
          const promoteMission = state.missions.find((m) => m.id === promote.missionId);
          if (promoteMission?.status === 'pending_dispatch') {
            missions = state.missions.map((m) => m.id === promote.missionId ? { ...m, status: 'dispatched' as const, updatedAt: now } : m);
          }
        }
        const events: EventLog[] = [{ id: crypto.randomUUID(), time: now, actor: '值班员', message: `协同请求 ${id} 已撤销，释放 ${req.externalUnitId} 时段` }];
        if (queued.length > 0) {
          events.push({ id: crypto.randomUUID(), time: now, actor: '值班员', message: `排队请求 ${queued[0].id} 递进放行` });
        }
        return {
          coordRequests: requests,
          missions,
          areas: recomputeCoverage(state.areas, state.assets, missions, requests, state.externalUnits),
          events: [...events, ...state.events]
        };
      }),

      submitReceipt: (input) => set((state) => {
        const now = new Date().toISOString();
        const code = input.requestCode.trim();
        const events: EventLog[] = [];

        // 回执按编号只入账一次
        if (state.receipts.some((r) => r.requestCode === code)) {
          events.push({ id: crypto.randomUUID(), time: now, actor: '电台', message: `回执 ${code} 重复到达，已按编号去重，不再入账` });
          return { events: [...events, ...state.events] };
        }

        const request = state.coordRequests.find((r) => r.id === code);
        if (!request) {
          // 没发过的回执先挂起对账
          const receipt: Receipt = { id: crypto.randomUUID(), requestCode: code, observedAt: input.observedAt, content: input.content, status: 'suspended', createdAt: now };
          events.push({ id: crypto.randomUUID(), time: now, actor: '电台', message: `回执 ${code} 无对应协同请求，已挂起对账` });
          return { receipts: [receipt, ...state.receipts], events: [...events, ...state.events] };
        }

        const mission = state.missions.find((m) => m.id === request.missionId);
        const receipt: Receipt = { id: crypto.randomUUID(), requestCode: code, observedAt: input.observedAt, content: input.content, status: 'recorded', createdAt: now };
        let missions = state.missions;
        let requests = state.coordRequests;

        if (mission?.closedAt && new Date(input.observedAt).getTime() < new Date(mission.closedAt).getTime()) {
          // 观测时刻早于任务关闭：只补进时间线，不重开任务
          events.push({ id: crypto.randomUUID(), time: now, actor: '电台', message: `回执 ${code} 观测时刻早于任务关闭（${mission.id}），已补入时间线，不重开任务` });
        } else {
          events.push({ id: crypto.randomUUID(), time: now, actor: '电台', message: `回执 ${code} 已入账：${input.content}` });
          if (request.status === 'confirmed') {
            requests = state.coordRequests.map((r) => r.id === code ? { ...r, status: 'released' as const } : r);
          }
          if (mission?.status === 'pending_dispatch') {
            missions = state.missions.map((m) => m.id === mission.id ? { ...m, status: 'dispatched' as const, updatedAt: now } : m);
          }
        }

        return {
          receipts: [receipt, ...state.receipts],
          missions,
          coordRequests: requests,
          areas: recomputeCoverage(state.areas, state.assets, missions, requests, state.externalUnits),
          events: [...events, ...state.events]
        };
      }),

      reconcileReceipt: (id) => set((state) => {
        const receipt = state.receipts.find((r) => r.id === id);
        if (!receipt || receipt.status !== 'suspended') return state;
        const now = new Date().toISOString();
        const request = state.coordRequests.find((r) => r.id === receipt.requestCode);
        if (!request) {
          return { events: [{ id: crypto.randomUUID(), time: now, actor: '值班员', message: `回执 ${receipt.requestCode} 对账仍无对应请求，继续挂起` }, ...state.events] };
        }
        let requests = state.coordRequests;
        if (request.status === 'confirmed') {
          requests = state.coordRequests.map((r) => r.id === request.id ? { ...r, status: 'released' as const } : r);
        }
        return {
          receipts: state.receipts.map((r) => r.id === id ? { ...r, status: 'recorded' as const } : r),
          coordRequests: requests,
          areas: recomputeCoverage(state.areas, state.assets, state.missions, requests, state.externalUnits),
          events: [{ id: crypto.randomUUID(), time: now, actor: '值班员', message: `回执 ${receipt.requestCode} 对账成功，已补入账` }, ...state.events]
        };
      }),

      backfillFromHistory: () => set((state) => {
        const { units, added } = backfillFromEvents(state.events, state.externalUnits);
        if (added.length === 0) {
          return { events: [{ id: crypto.randomUUID(), time: new Date().toISOString(), actor: '值班员', message: '历史事件中未发现未登记的外部力量来源' }, ...state.events] };
        }
        const now = new Date().toISOString();
        const events = added.map((name) => ({ id: crypto.randomUUID(), time: now, actor: '值班员', message: `按历史事件回填外部力量来源：${name}` }));
        return {
          externalUnits: [...units, ...state.externalUnits],
          events: [...events, ...state.events]
        };
      })
    }),
    {
      name: 'maritime-command-v1',
      version: 2,
      migrate: (persistedState, version) => {
        if (version < 2) {
          // 旧数据没有外部力量归属，升级时按历史事件回填未登记来源
          const prev = (persistedState ?? {}) as Partial<CommandState>;
          const { units } = backfillFromEvents(prev.events ?? [], []);
          return {
            ...prev,
            externalUnits: units,
            coordRequests: [],
            receipts: [],
            requestSeq: 0
          };
        }
        return persistedState as CommandState;
      }
    }
  )
);
