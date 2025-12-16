import { useState, useEffect } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import type { IFieldMeta, IViewMeta } from '@lark-base-open/js-sdk';
import { Button, Select, Form, Modal, Table, message, Alert, Typography, Card, Row, Col, Divider, Tag } from 'antd';
import { calculateMerges } from './utils/mergeLogic';
import type { MergeProposal } from './utils/mergeLogic';
import './App.css';

const { Title, Text } = Typography;

function App() {
  // Config State
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<IFieldMeta[]>([]);
  const [views, setViews] = useState<IViewMeta[]>([]);

  // Selection State
  const [viewId, setViewId] = useState<string>('all'); // 'all' or specific viewId
  const [startFieldId, setStartFieldId] = useState<string>();
  const [endFieldId, setEndFieldId] = useState<string>();
  const [groupFieldIds, setGroupFieldIds] = useState<string[]>([]);
  const [durationFieldId, setDurationFieldId] = useState<string>(); // Optional

  // Execution State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [merges, setMerges] = useState<MergeProposal[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    async function init() {
      const table = await bitable.base.getActiveTable();
      const metaList = await table.getFieldMetaList();
      setFields(metaList);
      const viewList = await table.getViewMetaList();
      setViews(viewList);
    }
    init();
  }, []);

  const handlePreview = async () => {
    if (!startFieldId || !endFieldId) {
      message.error("请先选择 开始时间 和 结束时间 字段");
      return;
    }
    setLoading(true);
    try {
      const table = await bitable.base.getActiveTable();
      // Record list fetching logic
      let rawRecordList;
      if (viewId !== 'all') {
        // Try using getRecords with viewId directly if supported, or fall back to view filtering
        rawRecordList = await table.getRecords({
          viewId: viewId,
          pageSize: 5000,
        } as any);
      } else {
        rawRecordList = await table.getRecords({
          pageSize: 5000,
        });
      }

      if (rawRecordList.records.length === 0) {
        message.warning("当前视图下没有找到记录。");
        setLoading(false);
        return;
      }

      const records = await Promise.all(rawRecordList.records.map(async (r) => {
        const startVal = r.fields[startFieldId] as number;
        const endVal = r.fields[endFieldId] as number;

        let durationVal: number | undefined = undefined;
        if (durationFieldId) {
          durationVal = Number(r.fields[durationFieldId]); // Check if Number
        }

        const groupVals = await Promise.all(groupFieldIds.map(async (fid) => {
          const val = r.fields[fid];
          if (!val) return "";
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        }));

        return {
          id: r.recordId,
          start: startVal,
          end: endVal,
          groupKeys: groupVals,
          duration: durationVal
        };
      }));

      // Filter invalid
      const validRecords = records.filter(r => r.start && r.end);

      const proposals = calculateMerges(validRecords);
      setMerges(proposals);

      if (proposals.length === 0) {
        message.info("未发现可合并的连续记录。");
      } else {
        setPreviewOpen(true);
      }

    } catch (e) {
      console.error(e);
      message.error("获取记录失败: " + String(e));
    } finally {
      setLoading(false);
    }
  };

  const executeMerge = async () => {
    setProcessing(true);
    try {
      const table = await bitable.base.getActiveTable();
      for (const p of merges) {
        // Update base (End Time Only)
        await table.setRecord(p.baseRecordId, {
          fields: {
            [endFieldId!]: p.newEnd
          }
        });
        if (p.recordsToDelete.length > 0) {
          await table.deleteRecords(p.recordsToDelete);
        }
      }
      message.success(`成功合并了 ${merges.length} 组记录！`);
      setPreviewOpen(false);
      setMerges([]);
    } catch (e) {
      console.error(e);
      message.error("合并出错: " + String(e));
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { title: '碎片数', key: 'cnt', width: 70, render: (_: any, r: MergeProposal) => r.originalRecords.length },
    { title: '分组', dataIndex: 'groupKey', key: 'groupKey', ellipsis: true, render: (_: any, r: MergeProposal) => r.originalRecords[0].groupKeys.join(', ') },
    {
      title: '合并后时间段', key: 'range', render: (_: any, r: MergeProposal) => {
        return (
          <div style={{ fontSize: 12 }}>
            {new Date(r.newStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {' '} → {' '}
            {new Date(r.newEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            <div style={{ color: '#999' }}>{new Date(r.newStart).toLocaleDateString()}</div>
          </div>
        )
      }
    },
    {
      title: '时长校验', key: 'validation', render: (_: any, r: MergeProposal) => {
        if (!r.validation) return <Tag color="default">未启用</Tag>;
        // Assume diff for display
        return (
          <div style={{ fontSize: 12 }}>
            原总和: {Number(r.validation.originalSum).toFixed(2)} <br />
            新时长: {(r.validation.newDuration / 3600000).toFixed(2)}h
          </div>
        );
      }
    }
  ];

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 10 }}>多维表格时间记录自动合并</Title>

      <div style={{ textAlign: 'center', marginBottom: 30, color: '#666' }}>
        <Text>只需一键，自动整理碎片化的连续时间记录。</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>由 <Text strong>Leon</Text> 与 AI 助手联合开发</Text>
      </div>

      <Card title="插件配置" bordered={false} style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="数据来源视图">
                <Select value={viewId} onChange={setViewId} style={{ width: '100%' }}>
                  <Select.Option value="all">所有记录 (All Records)</Select.Option>
                  {views.map(v => <Select.Option key={v.id} value={v.id}>{v.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="开始时间字段" required>
                <Select placeholder="请选择" options={fields.map(f => ({ label: f.name, value: f.id }))} value={startFieldId} onChange={setStartFieldId} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="结束时间字段" required>
                <Select placeholder="请选择" options={fields.map(f => ({ label: f.name, value: f.id }))} value={endFieldId} onChange={setEndFieldId} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="分组依据字段 (相同分组且时间连续才合并)" tooltip="建议选择任务名称、项目、标签等字段。">
            <Select mode="multiple" options={fields.map(f => ({ label: f.name, value: f.id }))} value={groupFieldIds} onChange={setGroupFieldIds} placeholder="搜索字段..." showSearch filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>

          <Divider dashed />

          <Form.Item label="[安全] 时长/工时校验字段" tooltip="这是一个可选的安全功能。如果你选择了工时字段（数字），插件会自动计算「合并前工时总和」与「合并后时间跨度」是否一致，防止数据异常。">
            <Select allowClear options={fields.map(f => ({ label: f.name, value: f.id }))} value={durationFieldId} onChange={setDurationFieldId} placeholder="可选：用于双重核对数据准确性" />
          </Form.Item>

          <Button type="primary" onClick={handlePreview} loading={loading} block size="large" style={{ marginTop: 10 }}>
            开始分析并预览 (Analyze)
          </Button>
        </Form>
      </Card>

      <Modal
        title={`确认合并：共发现 ${merges.length} 组连续记录`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        onOk={executeMerge}
        confirmLoading={processing}
        width={900}
        okText="确认合并并清理旧记录"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <Alert message="注意：合并操作将永久删除中间的碎片记录，只保留合并后的一条主记录。请务必确认！" type="warning" showIcon style={{ marginBottom: 16 }} />
        <Table
          dataSource={merges}
          columns={columns}
          rowKey="baseRecordId"
          pagination={{ pageSize: 5 }}
          size="small"
        />
      </Modal>
    </div>
  )
}

export default App
