type AutomationCounters = {
  queueTickCount: number;
  jobsProcessed: number;
  jobsFailed: number;
  jobsRequeued: number;
  lastTickAt: string | null;
};

const counters: AutomationCounters = {
  queueTickCount: 0,
  jobsProcessed: 0,
  jobsFailed: 0,
  jobsRequeued: 0,
  lastTickAt: null
};

export function recordAutomationQueueTick(input: { processed: number; failed: number; requeued: number }) {
  counters.queueTickCount += 1;
  counters.jobsProcessed += Math.max(0, input.processed);
  counters.jobsFailed += Math.max(0, input.failed);
  counters.jobsRequeued += Math.max(0, input.requeued);
  counters.lastTickAt = new Date().toISOString();
}

export function getAutomationCounters() {
  return { ...counters };
}
