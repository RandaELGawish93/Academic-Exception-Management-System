function getPendingRequests() {
  ensureWorkbookReady();

  if (!getCurrentUserContext_().isAcademicOffice) {
    return [];
  }

  return getAllRequests_().filter(function(request) {
    return request.status === REQUEST_STATUS.pending;
  });
}

function getRequestDetails(batchId) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  var request = getRequestByBatchId_(batchId);
  if (!request) {
    throw new Error('Request not found.');
  }

  return {
    request: request,
    students: getStudentsByBatchId_(batchId)
  };
}

function previewDecisionEmail(batchId, decisions, batchNote) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  var reviewData = buildBatchReviewData_(batchId, decisions, batchNote);

  return {
    details: reviewData,
    emailPreview: getDecisionEmailPreview(batchId, decisions, batchNote)
  };
}

function deleteRequest(batchId) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  updateRequestLifecycle_(batchId, {
    'Status': REQUEST_STATUS.deleted,
    'Decision At': new Date(),
    'Decision By': getCurrentUserEmail(),
    'Decision Note': 'Deleted from Action Center'
  });
  writeLog_('Request Deleted', batchId, '');

  return getHomeData();
}

function deleteRequests(batchIds) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  normalizeBatchIds_(batchIds).forEach(function(batchId) {
    updateRequestLifecycle_(batchId, {
      'Status': REQUEST_STATUS.deleted,
      'Decision At': new Date(),
      'Decision By': getCurrentUserEmail(),
      'Decision Note': 'Deleted from Action Center'
    });
    writeLog_('Request Deleted', batchId, '');
  });

  return getHomeData();
}

function buildBatchReviewData_(batchId, decisions, batchNote) {
  var request = getRequestByBatchId_(batchId);
  var students = getStudentsByBatchId_(batchId);
  var decisionMap = buildDecisionMap_(decisions);
  var processedStudents = students.map(function(student) {
    var decision = decisionMap[student.studentId];

    if (!decision || [DECISION_STATUS.approved, DECISION_STATUS.rejected].indexOf(decision.status) === -1) {
      throw new Error('Every student in the batch must be marked Approved or Rejected before generating the email preview.');
    }

    return mergeStudentDecision_(student, decision);
  });
  var grades = processedStudents.map(function(student) {
    return student.grade;
  });

  return {
    request: request,
    students: processedStudents,
    batchNote: cleanText_(batchNote || ''),
    principalCc: getPrincipalEmailsForGrades_(grades),
    summary: buildDecisionSummary_(processedStudents)
  };
}

function mergeStudentDecision_(student, decision) {
  var merged = JSON.parse(JSON.stringify(student));

  merged.decisionStatus = decision.status;
  merged.decisionNote = cleanText_(decision.note || '');

  return merged;
}

function buildDecisionMap_(decisions) {
  if (!Array.isArray(decisions) || !decisions.length) {
    throw new Error('At least one student decision is required.');
  }

  return decisions.reduce(function(map, decision) {
    map[decision.studentId] = {
      status: decision.status,
      note: decision.note
    };
    return map;
  }, {});
}

function buildDecisionSummary_(students) {
  var summary = {
    approvedCount: 0,
    rejectedCount: 0,
    totalCount: students.length,
    byExceptionType: {}
  };

  students.forEach(function(student) {
    if (student.decisionStatus === DECISION_STATUS.approved) {
      summary.approvedCount++;
    }

    if (student.decisionStatus === DECISION_STATUS.rejected) {
      summary.rejectedCount++;
    }

    if (!summary.byExceptionType[student.exceptionType]) {
      summary.byExceptionType[student.exceptionType] = {
        approved: [],
        rejected: []
      };
    }

    summary.byExceptionType[student.exceptionType][student.decisionStatus.toLowerCase()].push(student);
  });

  return summary;
}

function markBatchProcessed_(batchId, reviewData) {
  var request = getRequestByBatchId_(batchId);

  reviewData.students.forEach(function(student) {
    updateStudentDecision_(student.studentId, student.decisionStatus, student.decisionNote);
  });

  updateRequestLifecycle_(batchId, {
    'Status': REQUEST_STATUS.completed,
    'Decision At': new Date(),
    'Decision By': getCurrentUserEmail(),
    'Decision Note': reviewData.batchNote || '',
    'Email Sent At': new Date(),
    'Principal CC': reviewData.principalCc.join(', '),
    'Decision Summary': JSON.stringify(reviewData.summary)
  });

  writeLog_('Batch Processed', batchId, JSON.stringify({
    teacherEmail: request.teacherEmail,
    approved: reviewData.summary.approvedCount,
    rejected: reviewData.summary.rejectedCount,
    principalCc: reviewData.principalCc
  }));
}

function updateRequestLifecycle_(batchId, updates) {
  var request = getRequestByBatchId_(batchId);

  if (!request) {
    throw new Error('Request not found.');
  }

  updateRecordByRow_(SHEET_NAMES.requests, request.__rowNumber, updates);
}

function updateStudentDecision_(studentId, status, note) {
  var student = getStudentById_(studentId);

  if (!student) {
    throw new Error('Student record not found.');
  }

  updateRecordByRow_(SHEET_NAMES.students, student.__rowNumber, {
    'Decision Status': status,
    'Decision Note': cleanText_(note || '')
  });
}

function getAllRequests_() {
  return getSheetRecords_(SHEET_NAMES.requests).map(function(record) {
    return {
      __rowNumber: record.__rowNumber,
      batchId: record['Batch ID'],
      teacherName: record['Teacher Name'],
      teacherEmail: record['Teacher Email'],
      submittedAt: serializeDate_(record['Submitted At']),
      status: record['Status'] || REQUEST_STATUS.pending,
      studentCount: Number(record['Student Count'] || 0),
      decisionAt: serializeDate_(record['Decision At']),
      decisionBy: record['Decision By'] || '',
      decisionNote: record['Decision Note'] || '',
      emailSentAt: serializeDate_(record['Email Sent At']),
      submittedBy: record['Submitted By'] || '',
      submittedByRole: record['Submitted By Role'] || '',
      principalCc: record['Principal CC'] ? String(record['Principal CC']).split(/\s*,\s*/).filter(Boolean) : [],
      decisionSummary: parseJson_(record['Decision Summary'])
    };
  }).filter(function(request) {
    return request.batchId && request.status !== REQUEST_STATUS.deleted;
  });
}

function getRequestByBatchId_(batchId) {
  return getAllRequests_().filter(function(request) {
    return request.batchId === batchId;
  })[0] || null;
}

function getStudentsByBatchId_(batchId) {
  return getSheetRecords_(SHEET_NAMES.students).filter(function(record) {
    return record['Batch ID'] === batchId;
  }).map(function(record) {
    return {
      __rowNumber: record.__rowNumber,
      batchId: record['Batch ID'],
      studentId: record['Student ID'],
      studentName: record['Student Name'],
      grade: record['Grade'],
      subject: record['Subject'],
      exceptionType: record['Exception Type'],
      details: parseJson_(record['Details']),
      decisionStatus: record['Decision Status'] || DECISION_STATUS.pending,
      decisionNote: record['Decision Note'] || ''
    };
  });
}

function getStudentById_(studentId) {
  var students = getSheetRecords_(SHEET_NAMES.students).filter(function(record) {
    return record['Student ID'] === studentId;
  });

  if (!students.length) {
    return null;
  }

  return {
    __rowNumber: students[0].__rowNumber,
    studentId: students[0]['Student ID']
  };
}

function normalizeBatchIds_(batchIds) {
  if (!batchIds) {
    throw new Error('At least one request must be selected.');
  }

  if (!Array.isArray(batchIds)) {
    batchIds = [batchIds];
  }

  batchIds = batchIds.filter(function(batchId) {
    return Boolean(batchId);
  });

  if (!batchIds.length) {
    throw new Error('At least one request must be selected.');
  }

  return batchIds;
}
