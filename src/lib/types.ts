export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'pending' | 'dispatched' | 'in_progress' | 'closed';

export interface SearchArea {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  status: AreaStatus;
  coverage: number;
  /** 自有力量贡献的基础覆盖率，外部协同增益在此基础上重算 */
  baseCoverage: number;
}

export interface RescueAsset {
  id: string;
  name: string;
  type: 'ship' | 'helicopter' | 'drone' | 'shore';
  status: AssetStatus;
  lat: number;
  lng: number;
  lastSeen: string;
}

export interface Mission {
  id: string;
  title: string;
  areaId: string;
  assetIds: string[];
  status: MissionStatus;
  priority: 'normal' | 'urgent';
  note: string;
  updatedAt: string;
  /** 任务关闭时刻；晚到的回执据此判断只补时间线、不重开任务 */
  closedAt?: string;
}

export type ExternalUnitKind = 'fishery' | 'merchant' | 'other';
export type ExternalUnitStatus = 'available' | 'engaged' | 'withdrawn';

export interface ExternalUnit {
  id: string;
  name: string;
  kind: ExternalUnitKind;
  /** 同一时段最多放行的占用单数 */
  capacity: number;
  status: ExternalUnitStatus;
  radioChannel: string;
  /** manual: 值班登记；backfill: 升级时按历史事件回填 */
  source: 'manual' | 'backfill';
}

export type AssistRequestStatus = 'held' | 'queued' | 'released' | 'cancelled';

export interface AssistRequest {
  /** 协同请求编号，全账唯一，如 REQ-0001 */
  id: string;
  unitId: string;
  missionId: string;
  windowStart: string;
  windowEnd: string;
  status: AssistRequestStatus;
  /** 是否已有回执入账确认 */
  acknowledged: boolean;
  createdBy: string;
  createdAt: string;
  origin: 'dispatch' | 'backfill';
}

export type ReceiptStatus = 'posted' | 'suspended';

export interface AssistReceipt {
  /** 回执编号，同一编号只入账一次 */
  id: string;
  /** 对应的协同请求编号 */
  requestId: string;
  /** 电台观测时刻 */
  observedAt: string;
  receivedAt: string;
  status: ReceiptStatus;
  /** 观测时刻早于任务关闭：只补进时间线，不重开任务 */
  timelineOnly: boolean;
  note: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}
