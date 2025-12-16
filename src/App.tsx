import { useState, useEffect } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import type { IFieldMeta, IViewMeta } from '@lark-base-open/js-sdk';
import { Button, Select, Form, Modal, Table, message, Alert, Typography, Card, Row, Col, Divider, Tag } from 'antd';
import { calculateMerges } from './utils/mergeLogic';
import type { MergeProposal } from './utils/mergeLogic';
import './App.css';

const { Title } = Typography;

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
      message.error("Please select Start and End time fields");
      return;
    }
    setLoading(true);
    try {
      const table = await bitable.base.getActiveTable();
      // Record list fetching logic
      let rawRecordList;
      if (viewId !== 'all') {
        // Try using getRecords with viewId directly if supported, or fall back to view filtering
        // Official definition: table.getRecords({ viewId }) usually works.
        // If type check fails (older SDK types), cast to any.
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
        message.warning("No records found in current view.");
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
        message.info("No continuous records found to merge.");
      } else {
        setPreviewOpen(true);
      }

    } catch (e) {
      console.error(e);
      message.error("Failed to fetch records: " + String(e));
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
      message.success(`Merged ${merges.length} groups!`);
      setPreviewOpen(false);
      setMerges([]);
    } catch (e) {
      console.error(e);
      message.error("Merge error: " + String(e));
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { title: 'Count', key: 'cnt', width: 60, render: (_: any, r: MergeProposal) => r.originalRecords.length },
    { title: 'Group', dataIndex: 'groupKey', key: 'groupKey', ellipsis: true, render: (_: any, r: MergeProposal) => r.originalRecords[0].groupKeys.join(', ') },
    {
      title: 'New Range', key: 'range', render: (_: any, r: MergeProposal) => {
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
      title: 'Duration Check', key: 'validation', render: (_: any, r: MergeProposal) => {
        if (!r.validation) return <Tag color="default">N/A</Tag>;
        // Assume diff for display
        // const diff = Math.abs(r.validation.newDuration - r.validation.originalSum);

        return (
          <div style={{ fontSize: 12 }}>
            Sum: {Number(r.validation.originalSum).toFixed(2)} <br />
            Delta: {(r.validation.newDuration / 3600000).toFixed(2)}h
          </div>
        );
      }
    }
  ];

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Title level={3} style={{ textAlign: 'center', marginBottom: 30 }}>Time Record Merger</Title>

      <Card title="Configuration" bordered={false} style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label="Source View">
                <Select value={viewId} onChange={setViewId} style={{ width: '100%' }}>
                  <Select.Option value="all">All Records</Select.Option>
                  {views.map(v => <Select.Option key={v.id} value={v.id}>{v.name}</Select.Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Start Time" required>
                <Select options={fields.map(f => ({ label: f.name, value: f.id }))} value={startFieldId} onChange={setStartFieldId} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="End Time" required>
                <Select options={fields.map(f => ({ label: f.name, value: f.id }))} value={endFieldId} onChange={setEndFieldId} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="Grouping Fields">
            <Select mode="multiple" options={fields.map(f => ({ label: f.name, value: f.id }))} value={groupFieldIds} onChange={setGroupFieldIds} placeholder="Search fields..." showSearch filterOption={(input, option) => (option?.label ?? '').toLowerCase().includes(input.toLowerCase())} />
          </Form.Item>

          <Divider dashed />

          <Form.Item label="Safety: Validation Field (Duration)" tooltip="Select a number field representing task duration. We will verify that Sum(Original) ≈ New Duration.">
            <Select allowClear options={fields.map(f => ({ label: f.name, value: f.id }))} value={durationFieldId} onChange={setDurationFieldId} placeholder="Optional validation check" />
          </Form.Item>

          <Button type="primary" onClick={handlePreview} loading={loading} block size="large" style={{ marginTop: 10 }}>
            Analyze & Preview
          </Button>
        </Form>
      </Card>

      <Modal
        title={`Confirm Merge: ${merges.length} Groups Found`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        onOk={executeMerge}
        confirmLoading={processing}
        width={900}
        okText="Merge All"
        okButtonProps={{ danger: true }}
      >
        <Alert message="Merging will permanently delete the intermediate records shown in the count column." type="warning" showIcon style={{ marginBottom: 16 }} />
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
