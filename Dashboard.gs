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
