// Builds the dashboard summary AND the pending list from a single read of the
// Requests sheet, instead of reading it once for each.
function buildOfficeSnapshot_() {
  var summary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0
  };
  var pendingRequests = [];

  getAllRequests_().forEach(function(request) {
    summary.total += Number(request.studentCount || 0);

    if (request.status === REQUEST_STATUS.pending) {
      summary.pending += Number(request.studentCount || 0);
      pendingRequests.push(request);
      return;
    }

    summary.approved += Number((request.decisionSummary || {}).approvedCount || 0);
    summary.rejected += Number((request.decisionSummary || {}).rejectedCount || 0);
  });

  return {
    dashboard: summary,
    pendingRequests: pendingRequests
  };
}

function getDashboardSummary() {
  ensureWorkbookReady();

  var summary = {
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0
  };

  getAllRequests_().forEach(function(request) {
    if (request.status === REQUEST_STATUS.deleted) {
      return;
    }

    summary.total += Number(request.studentCount || 0);

    if (request.status === REQUEST_STATUS.pending) {
      summary.pending += Number(request.studentCount || 0);
      return;
    }

    summary.approved += Number((request.decisionSummary || {}).approvedCount || 0);
    summary.rejected += Number((request.decisionSummary || {}).rejectedCount || 0);
  });

  return summary;
}
