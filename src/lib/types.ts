export type AreaStatus = 'planned' | 'active' | 'closed';
export type AssetStatus = 'ready' | 'assigned' | 'offline' | 'returning';
export type MissionStatus = 'draft' | 'pending_dispatch' | 'dispatched' | 'in_progress' | 'closed';

export interface SearchArea {
  id: string;
  name: string;
  bounds: [number, number, number, number];
  status: AreaStatus;
  coverage: number;
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
  closedAt?: string;
}

export interface EventLog {
  id: string;
  time: string;
  actor: string;
  message: string;
}

// 外部单位（渔政船、商船等可请求的外部力量）
export type ExternalUnitType = 'fishery' | 'merchant' | 'other';
export type ExternalUnitStatus = 'available' | 'busy' | 'withdrawn';

export interface ExternalUnit {
  id: string;
  name: string;
  type: ExternalUnitType;
  capacity: number; // 同时段可放行单数
  status: ExternalUnitStatus;
  contact: string;
  source: 'registered' | 'backfilled'; // 登记来源：注册 / 历史回填
}

// 协同请求单（按编号占住外单位时段）
export type CoordRequestStatus = 'queued' | 'confirmed' | 'released' | 'withdrawn';

export interface CoordRequest {
  id: string; // 请求编号，如 XQ-0001
  missionId: string;
  externalUnitId: string;
  start: string;
  end: string;
  status: CoordRequestStatus;
  createdAt: string;
}

// 电台回执
export type ReceiptStatus = 'recorded' | 'suspended';

export interface Receipt {
  id: string;
  requestCode: string; // 对应请求编号
  observedAt: string; // 观测时刻
  content: string;
  status: ReceiptStatus;
  createdAt: string;
}
