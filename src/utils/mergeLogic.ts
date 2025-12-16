export interface IRecord {
    id: string;
    start: number; // timestamp
    end: number; // timestamp
    groupKeys: string[];
    duration?: number; // Optional duration for validation
}

export interface MergeProposal {
    baseRecordId: string;
    newStart: number;
    newEnd: number;
    recordsToDelete: string[];
    originalRecords: IRecord[];
    validation?: {
        originalSum: number;
        newDuration: number;
        isValid: boolean;
    };
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

                const isSequential = Math.abs(record.start - currentProposal.newEnd) < 1000;
                // Check if the new record is on the same day as the current block's start
                // Using locale string or UTC date components to check day equality
                const isSameDay = new Date(currentProposal.newStart).toDateString() === new Date(record.start).toDateString();

                if (isSequential && isSameDay) { // < 1 second diff AND same day 
                    // Merge!
                    currentProposal.newEnd = Math.max(currentProposal.newEnd, record.end);
                    currentProposal.recordsToDelete.push(record.id);
                    currentProposal.originalRecords.push(record);
                } else {
                    // Discontinuous. 
                    // Finalize previous proposal
                    if (currentProposal.recordsToDelete.length > 0) {
                        finalizeProposal(currentProposal);
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
            finalizeProposal(currentProposal);
            proposals.push(currentProposal);
        }
    });

    return proposals;
}

function finalizeProposal(p: MergeProposal) {
    // validation check
    const originalSum = p.originalRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    // duration in hours 
    // Usually timestamps are ms. 
    // But duration field usually depends on user input (Number). 
    // We'll compare raw numbers assuming consistent units, or just display them.
    // However, user said "Time Duration Field". 
    // Let's assume standard behavior: Duration = End - Start (ms).
    // If the User Selects a number field, we compare that number sum vs Time Delta.

    // Actually, simply summing the duration values provided is what's requested.
    // The "New Duration" is (NewEnd - NewStart).
    // We need unit conversion if the field is "Hours" but timestamps are ms.
    // For safety, we just calculate the sum and let UI decide how to display/warn, 
    // OR we calculate the Sum and store it.

    // Let's store precise values.
    const newDurationMs = p.newEnd - p.newStart;

    // Check if original records have duration
    const hasDuration = p.originalRecords.every(r => r.duration !== undefined);

    if (hasDuration) {
        // We can't strictly validate without knowing units. 
        // But usually: Sum(Durations) should match.
        // We will mark it valid if they are "close" relative to each other? 
        // No, simplest is just to pass the data back.
        p.validation = {
            originalSum: originalSum,
            newDuration: newDurationMs,
            isValid: true // Pending UI check or unit conversion
        };
    }
}
