'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, Grid, Group, List, Progress, Select, SimpleGrid, Stack, Switch, Table, Text, Textarea, TextInput, ThemeIcon, Timeline, Title } from '@mantine/core';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useState } from 'react';
import { useCommandStore } from '@/lib/store';
import type { CoordRequestStatus, ExternalUnitStatus, ExternalUnitType, ReceiptStatus } from '@/lib/types';
import { SearchMap } from '@/components/SearchMap';

const missionSchema = z.object({
  title: z.string().min(3, '任务名称至少3个字'),
  areaId: z.string().min(1),
  assetIds: z.array(z.string()).min(1, '至少调派一个单位'),
  priority: z.enum(['normal', 'urgent']),
  note: z.string().max(160)
});

const toLocalInput = (d: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const unitTypeLabel: Record<ExternalUnitType, string> = { fishery: '渔政', merchant: '商船', other: '其他' };
const unitStatusLabel: Record<ExternalUnitStatus, string> = { available: '可调用', busy: '繁忙', withdrawn: '已撤回' };
const requestStatusLabel: Record<CoordRequestStatus, string> = { queued: '排队中', confirmed: '已放行', released: '已回执', withdrawn: '已撤回' };
const receiptStatusLabel: Record<ReceiptStatus, string> = { recorded: '已入账', suspended: '挂起对账' };

export default function CommandPage() {
  const state = useCommandStore();
  const [selectedAssets, setSelectedAssets] = useState<string[]>(['ship-01']);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof missionSchema>>({
    resolver: zodResolver(missionSchema),
    defaultValues: { title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' }
  });
  const brief = useQuery({
    queryKey: ['sea-state'],
    queryFn: async () => ({ wind: '东北风 6级', visibility: '4.2海里', tide: '涨潮' }),
    refetchInterval: state.lowBandwidth ? false : 60_000
  });

  // 外部单位表单
  const [unitForm, setUnitForm] = useState({ name: '', type: 'fishery' as ExternalUnitType, capacity: 1, contact: '' });
  // 协同请求单表单
  const [requestForm, setRequestForm] = useState({ missionId: '', externalUnitId: '', start: toLocalInput(new Date()), end: toLocalInput(new Date(Date.now() + 60 * 60_000)) });
  // 电台回执表单
  const [receiptForm, setReceiptForm] = useState({ requestCode: '', observedAt: toLocalInput(new Date()), content: '' });

  const submitMission = (values: z.infer<typeof missionSchema>) => {
    state.dispatchMission({ ...values, assetIds: selectedAssets });
    reset({ title: '', areaId: state.areas[0]?.id, assetIds: selectedAssets, priority: 'urgent', note: '' });
  };

  const missionTitle = (id: string) => state.missions.find((m) => m.id === id)?.title ?? id;
  const unitName = (id: string) => state.externalUnits.find((u) => u.id === id)?.name ?? id;

  return (
    <main className={state.lowBandwidth ? 'low-bandwidth' : ''}>
      <Stack p="xl" gap="lg" maw={1600} mx="auto">
        <Group justify="space-between" align="flex-end">
          <div><Badge color={state.offline ? 'red' : 'teal'}>{state.offline ? '离线缓存模式' : '联合指挥在线'}</Badge><Title order={1} className="section-title">海上搜救联合指挥</Title><Text c="dimmed">外部力量与任务单按编号协同，时段占住、回执入账、撤回重派</Text></div>
          <Group><Switch label="低带宽" checked={state.lowBandwidth} onChange={state.toggleBandwidth} /><Switch label="模拟离线" checked={state.offline} onChange={state.toggleOffline} /></Group>
        </Group>

        <SimpleGrid cols={{ base: 1, md: 4 }}>
          {[
            ['活动搜索区', state.areas.filter((item) => item.status === 'active').length],
            ['在线单位', state.assets.filter((item) => item.status !== 'offline').length],
            ['进行中任务', state.missions.filter((item) => item.status === 'in_progress').length],
            ['外部力量', state.externalUnits.length]
          ].map(([label, value]) => <Card key={String(label)} withBorder><Text size="sm" c="dimmed">{label}</Text><Title order={2}>{value}</Title></Card>)}
        </SimpleGrid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 8 }}><Card withBorder><Group justify="space-between"><Title order={3}>搜救态势</Title><Text size="sm">风况：{brief.data?.wind ?? '读取中'} · 能见度：{brief.data?.visibility ?? '--'}</Text></Group><SearchMap areas={state.areas} assets={state.assets} externalUnits={state.externalUnits} /></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 4 }}><Card withBorder h="100%"><Title order={3}>单位状态</Title><Stack mt="md">{state.assets.map((asset) => {
            const stale = Date.now() - new Date(asset.lastSeen).getTime() > 10 * 60_000;
            return <Card key={asset.id} withBorder padding="sm"><Group justify="space-between"><b>{asset.name}</b><Badge color={asset.status === 'offline' ? 'red' : asset.status === 'assigned' ? 'blue' : 'teal'}>{asset.status}</Badge></Group><Text size="xs" c={stale ? 'red' : 'dimmed'}>{stale ? '位置已过期 · ' : ''}{formatDistanceToNow(new Date(asset.lastSeen), { addSuffix: true, locale: zhCN })}</Text><Group mt="xs"><Button size="compact-xs" onClick={() => state.setAssetStatus(asset.id, asset.status === 'offline' ? 'ready' : 'offline')}>{asset.status === 'offline' ? '恢复在线' : '标记失联'}</Button></Group></Card>;
          })}</Stack></Card></Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%"><Group justify="space-between"><Title order={3}>外部力量</Title><Button size="compact-xs" variant="light" onClick={state.backfillFromHistory}>回填历史来源</Button></Group>
              <Stack mt="md" gap="xs">
                {state.externalUnits.map((unit) => (
                  <Card key={unit.id} withBorder padding="sm">
                    <Group justify="space-between"><b>{unit.name}</b><Badge color={unit.status === 'withdrawn' ? 'gray' : unit.status === 'busy' ? 'orange' : 'violet'}>{unitStatusLabel[unit.status]}</Badge></Group>
                    <Text size="xs" c="dimmed">{unitTypeLabel[unit.type]} · 容量 {unit.capacity} · {unit.contact} · {unit.source === 'backfilled' ? '历史回填' : '已登记'}</Text>
                    <Group mt="xs">
                      <Button size="compact-xs" variant="light" onClick={() => state.setExternalUnitStatus(unit.id, unit.status === 'busy' ? 'available' : 'busy')}>{unit.status === 'busy' ? '恢复可调用' : '标记繁忙'}</Button>
                      <Button size="compact-xs" color="red" variant="light" onClick={() => state.withdrawExternalUnit(unit.id)} disabled={unit.status === 'withdrawn'}>撤回</Button>
                    </Group>
                  </Card>
                ))}
              </Stack>
              <Card withBorder padding="sm" mt="md">
                <Text size="sm" fw={600}>登记新外部力量</Text>
                <Stack mt="xs" gap="xs">
                  <TextInput size="xs" placeholder="名称，如 渔政33102" value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.currentTarget.value })} />
                  <Group gap="xs"><Select size="xs" style={{ flex: 1 }} data={[{ value: 'fishery', label: '渔政' }, { value: 'merchant', label: '商船' }, { value: 'other', label: '其他' }]} value={unitForm.type} onChange={(v) => setUnitForm({ ...unitForm, type: (v as ExternalUnitType) ?? 'fishery' })} /><TextInput size="xs" type="number" style={{ width: 80 }} value={unitForm.capacity} onChange={(e) => setUnitForm({ ...unitForm, capacity: Math.max(1, Number(e.currentTarget.value)) })} /></Group>
                  <TextInput size="xs" placeholder="联系方式，如 VHF 16频道" value={unitForm.contact} onChange={(e) => setUnitForm({ ...unitForm, contact: e.currentTarget.value })} />
                  <Button size="xs" onClick={() => { if (!unitForm.name.trim()) return; state.addExternalUnit({ name: unitForm.name.trim(), type: unitForm.type, capacity: unitForm.capacity, contact: unitForm.contact || '未留联系方式' }); setUnitForm({ name: '', type: 'fishery', capacity: 1, contact: '' }); }}>登记入协同账</Button>
                </Stack>
              </Card>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%"><Title order={3}>协同请求单</Title>
              <Stack mt="md" gap="xs">
                {state.coordRequests.length === 0 && <Text size="sm" c="dimmed">暂无协同请求单</Text>}
                {state.coordRequests.map((req) => (
                  <Card key={req.id} withBorder padding="sm">
                    <Group justify="space-between"><b>{req.id}</b><Badge color={req.status === 'confirmed' ? 'blue' : req.status === 'released' ? 'teal' : req.status === 'queued' ? 'yellow' : 'gray'}>{requestStatusLabel[req.status]}</Badge></Group>
                    <Text size="xs" c="dimmed">{missionTitle(req.missionId)} → {unitName(req.externalUnitId)}</Text>
                    <Text size="xs" c="dimmed">{new Date(req.start).toLocaleString()} – {new Date(req.end).toLocaleTimeString()}</Text>
                    {req.status !== 'withdrawn' && <Group mt="xs"><Button size="compact-xs" color="red" variant="light" onClick={() => state.cancelCoordRequest(req.id)}>撤销</Button></Group>}
                  </Card>
                ))}
              </Stack>
              <Card withBorder padding="sm" mt="md">
                <Text size="sm" fw={600}>发起协同请求</Text>
                <Stack mt="xs" gap="xs">
                  <Select size="xs" placeholder="选择任务" data={state.missions.filter((m) => m.status !== 'closed').map((m) => ({ value: m.id, label: m.title }))} value={requestForm.missionId} onChange={(v) => setRequestForm({ ...requestForm, missionId: v ?? '' })} />
                  <Select size="xs" placeholder="选择外部力量" data={state.externalUnits.map((u) => ({ value: u.id, label: `${u.name}（${unitStatusLabel[u.status]}）` }))} value={requestForm.externalUnitId} onChange={(v) => setRequestForm({ ...requestForm, externalUnitId: v ?? '' })} />
                  <Group gap="xs"><TextInput size="xs" type="datetime-local" style={{ flex: 1 }} value={requestForm.start} onChange={(e) => setRequestForm({ ...requestForm, start: e.currentTarget.value })} /><Text size="xs">至</Text><TextInput size="xs" type="datetime-local" style={{ flex: 1 }} value={requestForm.end} onChange={(e) => setRequestForm({ ...requestForm, end: e.currentTarget.value })} /></Group>
                  <Button size="xs" onClick={() => { if (!requestForm.missionId || !requestForm.externalUnitId) return; state.createCoordRequest({ missionId: requestForm.missionId, externalUnitId: requestForm.externalUnitId, start: new Date(requestForm.start).toISOString(), end: new Date(requestForm.end).toISOString() }); }}>按编号占住时段</Button>
                </Stack>
              </Card>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, lg: 4 }}>
            <Card withBorder h="100%"><Title order={3}>电台回执</Title>
              <Stack mt="md" gap="xs">
                {state.receipts.length === 0 && <Text size="sm" c="dimmed">暂无回执</Text>}
                {state.receipts.map((receipt) => (
                  <Card key={receipt.id} withBorder padding="sm">
                    <Group justify="space-between"><b>{receipt.requestCode}</b><Badge color={receipt.status === 'recorded' ? 'teal' : 'yellow'}>{receiptStatusLabel[receipt.status]}</Badge></Group>
                    <Text size="xs" c="dimmed">观测 {new Date(receipt.observedAt).toLocaleString()}</Text>
                    <Text size="xs">{receipt.content}</Text>
                    {receipt.status === 'suspended' && <Group mt="xs"><Button size="compact-xs" variant="light" onClick={() => state.reconcileReceipt(receipt.id)}>对账后入账</Button></Group>}
                  </Card>
                ))}
              </Stack>
              <Card withBorder padding="sm" mt="md">
                <Text size="sm" fw={600}>录入电台回执</Text>
                <Stack mt="xs" gap="xs">
                  <TextInput size="xs" placeholder="请求编号，如 XQ-0001" value={receiptForm.requestCode} onChange={(e) => setReceiptForm({ ...receiptForm, requestCode: e.currentTarget.value })} />
                  <TextInput size="xs" type="datetime-local" value={receiptForm.observedAt} onChange={(e) => setReceiptForm({ ...receiptForm, observedAt: e.currentTarget.value })} />
                  <TextInput size="xs" placeholder="回执内容" value={receiptForm.content} onChange={(e) => setReceiptForm({ ...receiptForm, content: e.currentTarget.value })} />
                  <Button size="xs" onClick={() => { if (!receiptForm.requestCode.trim()) return; state.submitReceipt({ requestCode: receiptForm.requestCode.trim(), observedAt: new Date(receiptForm.observedAt).toISOString(), content: receiptForm.content || '电台回执' }); setReceiptForm({ requestCode: '', observedAt: toLocalInput(new Date()), content: '' }); }}>入账</Button>
                </Stack>
              </Card>
            </Card>
          </Grid.Col>
        </Grid>

        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, lg: 5 }}><Card withBorder><Title order={3}>派发新任务</Title><form onSubmit={handleSubmit(submitMission)}><Stack mt="md"><TextInput label="任务名称" {...register('title')} error={errors.title?.message} /><label>搜索区<select {...register('areaId')} style={{ width: '100%', padding: 8 }}>{state.areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>调派单位（可多选）<select multiple value={selectedAssets} onChange={(event) => setSelectedAssets(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} style={{ width: '100%', minHeight: 86 }}>{state.assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label><label>优先级<select {...register('priority')} style={{ width: '100%', padding: 8 }}><option value="urgent">紧急</option><option value="normal">常规</option></select></label><Textarea label="任务说明" {...register('note')} /><Button type="submit">派发任务</Button></Stack></form></Card></Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }}><Card withBorder><Title order={3}>任务与搜索区</Title><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">搜索区</th><th align="left">状态</th><th align="left">覆盖率</th></tr></thead><tbody>{state.areas.map((area) => <tr key={area.id}><td style={{ padding: '8px 0' }}>{area.name}</td><td>{area.status}</td><td style={{ width: '42%' }}><Progress value={area.coverage} /></td></tr>)}</tbody></table><List mt="lg" spacing="sm">{state.missions.map((mission) => {
            const statusColor = mission.status === 'in_progress' ? 'blue' : mission.status === 'closed' ? 'gray' : mission.status === 'pending_dispatch' ? 'orange' : 'teal';
            const statusText = mission.status === 'pending_dispatch' ? '待派' : mission.status;
            return <List.Item key={mission.id}><Group justify="space-between"><div><b>{mission.title}</b><Text size="xs" c="dimmed">{mission.areaId} · {mission.assetIds.join(' / ')}</Text></div><Group><Badge color={statusColor}>{statusText}</Badge>{mission.status !== 'closed' && <Button size="compact-xs" onClick={() => state.setMissionStatus(mission.id, 'closed')}>关闭</Button>}{mission.status === 'closed' && <Button size="compact-xs" onClick={() => state.setMissionStatus(mission.id, 'in_progress')}>重开</Button>}</Group></Group></List.Item>;
          })}</List></Card></Grid.Col>
        </Grid>

        <Card withBorder><Title order={3}>联合事件时间线</Title><Timeline mt="lg" active={1} bulletSize={18} lineWidth={2}>{state.events.slice(0, 10).map((event) => <Timeline.Item key={event.id} title={`${event.actor} · ${new Date(event.time).toLocaleTimeString()}`}><Text size="sm">{event.message}</Text></Timeline.Item>)}</Timeline></Card>
      </Stack>
    </main>
  );
}
