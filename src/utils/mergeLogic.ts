export interface IRecord {
    id: string;
    start: number; // timestamp
    end: number; // timestamp
    groupKeys: string[]; // Values of the grouping fields (e.g. ["Work", "Tag1"])
}

export interface MergeProposal {
    baseRecordId: string;
    newStart: number;
    newEnd: number;
    recordsToDelete: string[];
    originalRecords: IRecord[];
}

/**
 * Groups records by their groupKeys, sorts by start time, 
 * and identifies continuous blocks to merge.
 */
export function calculateMerges(records: IRecord[]): MergeProposal[] {
    const proposals: MergeProposal[] = [];

    // 1. Group records
    const groups: Record<string, IRecord[]> = {};
    records.forEach(r => {
        const key = r.groupKeys.join('|||'); // Simple separator
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
    });

    // 2. Process each group
    Object.values(groups).forEach(groupRecords => {
        // Sort by start time ASC
        groupRecords.sort((a, b) => a.start - b.start);

        if (groupRecords.length === 0) return;

        let currentProposal: MergeProposal | null = null;

        for (let i = 0; i < groupRecords.length; i++) {
            const record = groupRecords[i];

            if (!currentProposal) {
                // Start a new potential merge block
                currentProposal = {
                    baseRecordId: record.id,
                    newStart: record.start,
                    newEnd: record.end,
                    recordsToDelete: [],
                    originalRecords: [record]
                };
            } else {
                // Check for continuity
                // Tolerance: We assume strict equality for now as per req "Start = End"
                // Note: Timestamps might have minor diffs, but user example implies strict match.
                // Let's assume strict match or very small epsilon if needed.
                // User example: 10:00 -> 10:00.

                if (Math.abs(record.start - currentProposal.newEnd) < 1000) { // < 1 second diff 
                    // Merge!
                    currentProposal.newEnd = Math.max(currentProposal.newEnd, record.end);
                    currentProposal.recordsToDelete.push(record.id);
                    currentProposal.originalRecords.push(record);
                } else {
                    // Discontinuous. 
                    // Save current proposal IF it involves more than 1 record (i.e. has deletions)
                    if (currentProposal.recordsToDelete.length > 0) {
                        proposals.push(currentProposal);
                    }
                    // Start new proposal
                    currentProposal = {
                        baseRecordId: record.id,
                        newStart: record.start,
                        newEnd: record.end,
                        recordsToDelete: [],
                        originalRecords: [record]
                    };
                }
            }
        }

        // Push the last one if valid
        if (currentProposal && currentProposal.recordsToDelete.length > 0) {
            proposals.push(currentProposal);
        }
    });

    return proposals;
}
