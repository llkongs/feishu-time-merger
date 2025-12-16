import { useState, useEffect } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import type { IFieldMeta } from '@lark-base-open/js-sdk';
import { Button, Select, Form, Modal, Table, message, Alert, Typography } from 'antd';
import { calculateMerges } from './utils/mergeLogic';
import type { MergeProposal } from './utils/mergeLogic';
import './App.css';

const { Title, Text } = Typography;

function App() {
  const [fields, setFields] = useState<IFieldMeta[]>([]);
  const [startFieldId, setStartFieldId] = useState<string>();
  const [endFieldId, setEndFieldId] = useState<string>();
  const [groupFieldIds, setGroupFieldIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [merges, setMerges] = useState<MergeProposal[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    async function init() {
      const table = await bitable.base.getActiveTable();
      const metaList = await table.getFieldMetaList();
      setFields(metaList);
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
      // Fetch records (pageSize default is small, set higher)
      const recordList = await table.getRecords({
        pageSize: 5000
      });

      const rawRecords = await Promise.all(recordList.records.map(async (r) => {
        const startVal = r.fields[startFieldId] as number;
        const endVal = r.fields[endFieldId] as number;

        // Group values: generic string representation
        const groupVals = await Promise.all(groupFieldIds.map(async (fid) => {
          const val = r.fields[fid];
          // Simple serialization for grouping
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        }));

        return {
          id: r.recordId,
          start: startVal,
          end: endVal,
          groupKeys: groupVals
        };
      }));

      // Filter invalid records (missing times)
      const validRecords = rawRecords.filter(r => r.start && r.end);

      const proposals = calculateMerges(validRecords);
      setMerges(proposals);

      if (proposals.length === 0) {
        message.info("No continuous time records found to merge.");
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

      // Process sequentially or in small batches
      for (const p of merges) {
        // 1. Update the base record
        await table.setRecord(p.baseRecordId, {
          fields: {
            [endFieldId!]: p.newEnd
          }
        });
        // 2. Delete the merged records
        if (p.recordsToDelete.length > 0) {
          await table.deleteRecords(p.recordsToDelete);
        }
      }
      message.success(`Successfully merged ${merges.length} groups!`);
      setPreviewOpen(false);
      setMerges([]);
      // Refresh?
    } catch (e) {
      console.error(e);
      message.error("Error during merge: " + String(e));
    } finally {
      setProcessing(false);
    }
  };

  const columns = [
    { title: 'Group', dataIndex: 'groupKey', key: 'groupKey', render: (_: any, r: MergeProposal) => r.originalRecords[0].groupKeys.join(', ') },
    { title: 'Records to Merge', key: 'count', render: (_: any, r: MergeProposal) => r.originalRecords.length },
    {
      title: 'New Time Range', key: 'range', render: (_: any, r: MergeProposal) => {
        return `${new Date(r.newStart).toLocaleString()} -> ${new Date(r.newEnd).toLocaleString()}`;
      }
    }
  ];

  return (
    <div style={{ padding: 20 }}>
      <Title level={3}>Time Record Merger</Title>
      <Alert message="This tool merges continuous time records. Please backup data before use." type="warning" showIcon style={{ marginBottom: 20 }} />

      <Form layout="vertical">
        <Form.Item label="Start Time Field" required>
          <Select
            options={fields.map(f => ({ label: f.name, value: f.id }))}
            value={startFieldId} onChange={setStartFieldId}
            placeholder="Select Start Time"
          />
        </Form.Item>
        <Form.Item label="End Time Field" required>
          <Select
            options={fields.map(f => ({ label: f.name, value: f.id }))}
            value={endFieldId} onChange={setEndFieldId}
            placeholder="Select End Time"
          />
        </Form.Item>
        <Form.Item label="Grouping Category Fields (Optional)">
          <Select
            mode="multiple"
            options={fields.map(f => ({ label: f.name, value: f.id }))}
            value={groupFieldIds} onChange={setGroupFieldIds}
            placeholder="Select fields to group by (e.g. Activity, Tag)"
          />
        </Form.Item>

        <Button type="primary" onClick={handlePreview} loading={loading} block size="large">
          Preview Merges
        </Button>
      </Form>

      <Modal
        title={`Confirm Merge (${merges.length} Groups)`}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        onOk={executeMerge}
        confirmLoading={processing}
        width={800}
        okText="Merge & Delete"
        okButtonProps={{ danger: true }}
      >
        <Text>The following groups of records are continuous and will be merged into single records. Intermediate records will be <b>permanently deleted</b>.</Text>
        <Table
          dataSource={merges}
          columns={columns}
          rowKey="baseRecordId"
          pagination={{ pageSize: 5 }}
          style={{ marginTop: 10 }}
          size="small"
        />
      </Modal>
    </div>
  )
}

export default App
