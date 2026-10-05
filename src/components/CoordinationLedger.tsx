'use client';

import { useState } from 'react';
import { Badge, Button, Card, Grid, Group, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { format } from 'date-fns';
import { useCommandStore } from '@/lib/store';
import type { AssistRequestStatus, ExternalUnitKind, ExternalUnitStatus } from '@/lib/types';

const fmt = (isoString: string) => format(new Date(isoString), 'MM-dd HH:mm');
const toLocalInput = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

const unitKindLabel: Record<ExternalUnitKind, string> = { fishery: '渔政', merchant: '商船', other: '其他' };
const unitStatusLabel: Record<ExternalUnitStatus, string> = { available: '可用', engaged: '占用中', withdrawn: '已撤回' };
const unitStatusColor: Record<ExternalUnitStatus, string> = { available: 'teal', engaged: 'blue', withdrawn: 'red' };
const requestStatusLabel: Record<AssistRequestStatus, string> = { held: '占住', queued: '排队中', released: '已释放', cancelled: '已取消' };
const requestStatusColor: Record<AssistRequestStatus, string> = { held: 'teal', queued: 'orange', released: 'gray', cancelled: 'red' };

const fieldStyle = { width: '100%', padding: 8 } as const;

export function CoordinationLedger() {
  const externalUnits = useCommandStore((state) => state.externalUnits);
  const requests = useCommandStore((state) => state.requests);
  const receipts = useCommandStore((state) => state.receipts);
  const missions = useCommandStore((state) => state.missions);
  const submitAssistRequest = useCommandStore((state) => state.submitAssistRequest);
  const releaseRequest = useCommandStore((state) => state.releaseRequest);
  const postReceipt = useCommandStore((state) => state.postReceipt);
  const setExternalUnitStatus = useCommandStore((state) => state.setExternalUnitStatus);
  const reconcileSuspended = useCommandStore((state) => state.reconcileSuspended);
  const runBackfill = useCommandStore((state) => state.runBackfill);

  const openMissions = missions.filter((mission) => mission.status !== 'closed');
  const [unitId, setUnitId] = useState('');
  const [missionId, setMissionId] = useState('');
  const [windowStart, setWindowStart] = useState(toLocalInput(new Date()));
  const [windowEnd, setWindowEnd] = useState(toLocalInput(new Date(Date.now() + 2 * 3600_000)));
  const [officer, setOfficer] = useState('值班员A');
  const [requestError, setRequestError] = useState('');

  const [receiptId, setReceiptId] = useState('');
  const [receiptRequestId, setReceiptRequestId] = useState('');
  const [observedAt, setObservedAt] = useState(toLocalInput(new Date()));
  const [receiptNote, setReceiptNote] = useState('');
  const [receiptError, setReceiptError] = useState('');

  const activeUnitId = unitId || externalUnits[0]?.id || '';
  const activeMissionId = missionId || openMissions[0]?.id || '';
  const suspended = receipts.filter((receipt) => receipt.status === 'suspended');

  const submitRequest = () => {
    if (!activeUnitId || !activeMissionId) {
      setRequestError('请选择外单位与任务');
      return;
    }
    const start = new Date(windowStart);
    const end = new Date(windowEnd);
    if (!(start.getTime() < end.getTime())) {
      setRequestError('结束时刻必须晚于开始时刻');
      return;
    }
    setRequestError('');
    submitAssistRequest({ unitId: activeUnitId, missionId: activeMissionId, windowStart: start.toISOString(), windowEnd: end.toISOString(), createdBy: officer.trim() || '值班员' });
  };

  const submitReceipt = () => {
    if (!receiptRequestId.trim()) {
      setReceiptError('请填写对应请求编号');
      return;
    }
    setReceiptError('');
    postReceipt({ id: receiptId.trim() || undefined, requestId: receiptRequestId.trim(), observedAt: new Date(observedAt).toISOString(), note: receiptNote.trim() });
    setReceiptId('');
    setReceiptNote('');
  };

  return (
    <Card withBorder>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={3}>外部力量协同账</Title>
          <Text size="sm" c="dimmed">按编号占住时段 · 同时段只放行一单 · 回执编号只入账一次</Text>
        </div>
        <Button variant="light" size="compact-sm" onClick={runBackfill}>按历史事件回填未登记来源</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2 }} mt="md">
        {externalUnits.map((unit) => {
          const held = requests.filter((request) => request.unitId === unit.id && request.status === 'held').length;
          const queued = requests.filter((request) => request.unitId === unit.id && request.status === 'queued').length;
          return (
            <Card key={unit.id} withBorder padding="sm">
              <Group justify="space-between">
                <b>{unit.name}</b>
                <Badge color={unitStatusColor[unit.status]}>{unitStatusLabel[unit.status]}</Badge>
              </Group>
              <Text size="xs" c="dimmed">
                {unitKindLabel[unit.kind]} · 容量 {unit.capacity} 单/时段 · {unit.radioChannel}{unit.source === 'backfill' ? ' · 历史回填登记' : ''}
              </Text>
              <Text size="xs" mt={4}>占住 {held} 单 / 排队 {queued} 单</Text>
              <Group mt="xs">
                {unit.status === 'withdrawn' ? (
                  <Button size="compact-xs" color="teal" onClick={() => setExternalUnitStatus(unit.id, 'available')}>恢复可用</Button>
                ) : (
                  <Button size="compact-xs" color="red" variant="light" onClick={() => setExternalUnitStatus(unit.id, 'withdrawn')}>撤回</Button>
                )}
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>

      <Grid mt="md">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder padding="sm">
            <Title order={4}>发协同请求</Title>
            <Stack mt="sm" gap="xs">
              <label>外单位
                <select value={activeUnitId} onChange={(event) => setUnitId(event.currentTarget.value)} style={fieldStyle}>
                  {externalUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}（{unitStatusLabel[unit.status]}）</option>)}
                </select>
              </label>
              <label>对应任务
                <select value={activeMissionId} onChange={(event) => setMissionId(event.currentTarget.value)} style={fieldStyle}>
                  {openMissions.map((mission) => <option key={mission.id} value={mission.id}>{mission.title}</option>)}
                </select>
              </label>
              <Group grow>
                <label>时段开始
                  <input type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.currentTarget.value)} style={fieldStyle} />
                </label>
                <label>时段结束
                  <input type="datetime-local" value={windowEnd} onChange={(event) => setWindowEnd(event.currentTarget.value)} style={fieldStyle} />
                </label>
              </Group>
              <TextInput label="值班员" value={officer} onChange={(event) => setOfficer(event.currentTarget.value)} />
              {requestError && <Text size="sm" c="red">{requestError}</Text>}
              <Button onClick={submitRequest}>发请求占住时段</Button>
            </Stack>
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder padding="sm">
            <Title order={4}>电台回执入账</Title>
            <Stack mt="sm" gap="xs">
              <TextInput label="回执编号（留空自动编号）" placeholder="HJ-0003" value={receiptId} onChange={(event) => setReceiptId(event.currentTarget.value)} />
              <label>对应请求编号
                <input list="assist-request-ids" value={receiptRequestId} onChange={(event) => setReceiptRequestId(event.currentTarget.value)} placeholder="REQ-0001" style={fieldStyle} />
                <datalist id="assist-request-ids">
                  {requests.map((request) => <option key={request.id} value={request.id} />)}
                </datalist>
              </label>
              <label>观测时刻
                <input type="datetime-local" value={observedAt} onChange={(event) => setObservedAt(event.currentTarget.value)} style={fieldStyle} />
              </label>
              <TextInput label="备注" value={receiptNote} onChange={(event) => setReceiptNote(event.currentTarget.value)} />
              {receiptError && <Text size="sm" c="red">{receiptError}</Text>}
              <Button onClick={submitReceipt}>回执入账</Button>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      <Title order={4} mt="lg">占用台账</Title>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr><th align="left">编号</th><th align="left">外单位</th><th align="left">任务</th><th align="left">时段</th><th align="left">状态</th><th align="left">回执</th><th /></tr>
        </thead>
        <tbody>
          {requests.map((request) => {
            const unit = externalUnits.find((item) => item.id === request.unitId);
            const mission = missions.find((item) => item.id === request.missionId);
            const posted = receipts.filter((receipt) => receipt.requestId === request.id && receipt.status === 'posted').length;
            return (
              <tr key={request.id}>
                <td style={{ padding: '6px 0' }}>{request.id}{request.origin === 'backfill' ? '（回填）' : ''}</td>
                <td>{unit?.name ?? request.unitId}</td>
                <td>{mission?.title ?? request.missionId}</td>
                <td>{fmt(request.windowStart)} ~ {fmt(request.windowEnd)}</td>
                <td><Badge color={requestStatusColor[request.status]}>{requestStatusLabel[request.status]}</Badge></td>
                <td>{request.acknowledged ? `已确认 ${posted} 条` : '—'}</td>
                <td>{(request.status === 'held' || request.status === 'queued') && (
                  <Button size="compact-xs" variant="subtle" onClick={() => releaseRequest(request.id, '值班员手动释放')}>释放</Button>
                )}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {suspended.length > 0 && (
        <Card withBorder padding="sm" mt="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
          <Group justify="space-between">
            <Text fw={600} c="red">挂起对账（{suspended.length}）</Text>
            <Button size="compact-xs" variant="light" onClick={reconcileSuspended}>尝试对账</Button>
          </Group>
          {suspended.map((receipt) => (
            <Text key={receipt.id} size="sm">回执 {receipt.id} → 未发出的 {receipt.requestId} · 观测 {fmt(receipt.observedAt)}</Text>
          ))}
        </Card>
      )}

      <Title order={4} mt="lg">回执记录</Title>
      <Stack gap={4} mt="xs">
        {receipts.slice(0, 6).map((receipt) => (
          <Group key={receipt.id} gap="xs">
            <Badge color={receipt.status === 'posted' ? 'teal' : 'orange'}>{receipt.status === 'posted' ? '已入账' : '挂起'}</Badge>
            <Text size="sm">{receipt.id} → {receipt.requestId} · 观测 {fmt(receipt.observedAt)}{receipt.note ? ` · ${receipt.note}` : ''}</Text>
            {receipt.timelineOnly && <Badge color="gray">仅补时间线</Badge>}
          </Group>
        ))}
      </Stack>
    </Card>
  );
}
