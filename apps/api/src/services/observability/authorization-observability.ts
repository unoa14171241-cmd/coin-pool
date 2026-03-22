let syncAuthorizationDeniedCount = 0;
let automationAuthorizationDeniedCount = 0;

export function recordSyncAuthorizationDenied() {
  syncAuthorizationDeniedCount += 1;
}

export function recordAutomationAuthorizationDenied() {
  automationAuthorizationDeniedCount += 1;
}

export function getAuthorizationCounters() {
  return {
    syncAuthorizationDeniedCount,
    automationAuthorizationDeniedCount
  };
}
