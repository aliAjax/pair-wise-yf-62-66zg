// 逻辑验证：五条协同规则
// 运行：npx tsx src/lib/store.test.ts
import { useCommandStore } from './store';

// ---- 浏览器环境 mock ----
const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v); },
  removeItem: (k: string) => { memory.delete(k); }
};
let seq = 0;
// Node 20 自带 globalThis.crypto.randomUUID，直接用；此处仅在缺失时兜底
if (!(globalThis as any).crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', { value: { randomUUID: () => `uuid-${++seq}` } });
}

const iso = (h: number, m = 0) => new Date(2026, 9, 5, h, m).toISOString();
let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

const s = useCommandStore.getState();
// 取一个外部单位和一个进行中任务
const unit = s.externalUnits[0]; // 渔政33001, capacity 1
const mission = s.missions.find((m) => m.status === 'in_progress')!;
console.log(`外部单位: ${unit.name} (容量 ${unit.capacity}), 任务: ${mission.title}`);

// 规则1：按编号占住时段，同一时段只放行一单，超出容量排队
console.log('\n[规则1] 按编号占时段 + 排队');
s.createCoordRequest({ missionId: mission.id, externalUnitId: unit.id, start: iso(10), end: iso(12) });
s.createCoordRequest({ missionId: mission.id, externalUnitId: unit.id, start: iso(11), end: iso(13) }); // 重叠
s.createCoordRequest({ missionId: mission.id, externalUnitId: unit.id, start: iso(14), end: iso(16) }); // 不重叠
let reqs = useCommandStore.getState().coordRequests;
const r1 = reqs.find((r) => r.id === 'XQ-0001')!;
const r2 = reqs.find((r) => r.id === 'XQ-0002')!;
const r3 = reqs.find((r) => r.id === 'XQ-0003')!;
check('XQ-0001 重叠时段放行', r1.status === 'confirmed');
check('XQ-0002 同时段超容排队', r2.status === 'queued');
check('XQ-0003 不重叠时段放行', r3.status === 'confirmed');

// 规则2：回执按编号只入账一次；没发过的挂起对账
console.log('\n[规则2] 回执去重 + 挂起对账');
s.submitReceipt({ requestCode: 'XQ-0001', observedAt: iso(10, 30), content: '已抵达现场' });
s.submitReceipt({ requestCode: 'XQ-0001', observedAt: iso(10, 31), content: '重复回执' });
s.submitReceipt({ requestCode: 'XQ-9999', observedAt: iso(10, 32), content: '来历不明' });
let receipts = useCommandStore.getState().receipts;
check('XQ-0001 只入账一次', receipts.filter((r) => r.requestCode === 'XQ-0001' && r.status === 'recorded').length === 1);
check('XQ-9999 挂起对账', receipts.find((r) => r.requestCode === 'XQ-9999')?.status === 'suspended');
check('XQ-0001 回执后请求放行', useCommandStore.getState().coordRequests.find((r) => r.id === 'XQ-0001')?.status === 'released');
// 挂起回执对账后入账
s.reconcileReceipt(receipts.find((r) => r.requestCode === 'XQ-9999')!.id);
check('XQ-9999 对账后仍挂起（无对应请求）', useCommandStore.getState().receipts.find((r) => r.requestCode === 'XQ-9999')?.status === 'suspended');

// 规则3：外单位撤回 → 任务退回待派 + 重算覆盖率
console.log('\n[规则3] 撤回 → 退回待派 + 覆盖率重算');
const areaBefore = useCommandStore.getState().areas.find((a) => a.id === mission.areaId)!.coverage;
s.withdrawExternalUnit(unit.id);
const after = useCommandStore.getState();
check('外部单位已撤回', after.externalUnits.find((u) => u.id === unit.id)?.status === 'withdrawn');
check('XQ-0003 已撤回', after.coordRequests.find((r) => r.id === 'XQ-0003')?.status === 'withdrawn');
check('关联任务退回待派', after.missions.find((m) => m.id === mission.id)?.status === 'pending_dispatch');
const areaAfter = after.areas.find((a) => a.id === mission.areaId)!.coverage;
check(`覆盖率重算下降 (${areaBefore} → ${areaAfter})`, areaAfter < areaBefore);

// 规则4：观测时刻早于任务关闭的回执只补时间线，不重开
console.log('\n[规则4] 早到回执不重开任务');
// 先把任务关闭
s.setMissionStatus(mission.id, 'closed');
const closedAt = useCommandStore.getState().missions.find((m) => m.id === mission.id)!.closedAt!;
// 再发一个新请求并回执，观测时刻早于关闭时间
s.createCoordRequest({ missionId: mission.id, externalUnitId: unit.id, start: iso(8), end: iso(9) });
const newReq = useCommandStore.getState().coordRequests[0];
s.submitReceipt({ requestCode: newReq.id, observedAt: new Date(new Date(closedAt).getTime() - 60_000).toISOString(), content: '关闭前的观测' });
const missionAfter = useCommandStore.getState().missions.find((m) => m.id === mission.id)!;
check('任务保持关闭，未重开', missionAfter.status === 'closed');
check('回执已补入时间线', useCommandStore.getState().receipts.some((r) => r.requestCode === newReq.id && r.status === 'recorded'));

// 规则5：历史事件回填未登记来源
console.log('\n[规则5] 历史事件回填');
const unitsBefore = useCommandStore.getState().externalUnits.length;
s.backfillFromHistory();
const unitsAfter = useCommandStore.getState().externalUnits.length;
check('回填新增外部力量', unitsAfter > unitsBefore);
check('回填来源标记为 backfilled', useCommandStore.getState().externalUnits.some((u) => u.source === 'backfilled'));
check('回填的是历史事件中的渔政33102', useCommandStore.getState().externalUnits.some((u) => u.name === '渔政33102'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
