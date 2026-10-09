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

  // Build the review data ONCE and pass it to the email builder,
  // instead of rebuilding it (two more full sheet reads) inside the preview call.
  var reviewData = buildBatchReviewData_(batchId, decisions, batchNote);

  return {
    details: reviewData,
    emailPreview: buildEmailPreviewData_(reviewData, getAppSettings())
  };
}

function deleteRequest(batchId) {
  return deleteRequests([batchId]);
}

function deleteRequests(batchIds) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  var ids = normalizeBatchIds_(batchIds);

  // Read the Requests sheet ONCE and resolve every row number from memory,
  // instead of one full read per deleted request.
  var requestByBatchId = {};
  getAllRequests_().forEach(function(request) {
    requestByBatchId[request.batchId] = request;
  });

  var now = new Date();
  var user = getCurrentUserEmail();
  var logRecords = [];

  ids.forEach(function(batchId) {
    var request = requestByBatchId[batchId];

    if (!request) {
      throw new Error('Request not found.');
    }

    updateRecordByRow_(SHEET_NAMES.requests, request.__rowNumber, {
      'Status': REQUEST_STATUS.deleted,
      'Decision At': now,
      'Decision By': user,
      'Decision Note': 'Deleted from Action Center'
    });

    logRecords.push({
      'Timestamp': now,
      'Action': 'Request Deleted',
      'Batch ID': batchId,
      'User': user,
      'Details': ''
    });
  });

  // One batched log write for all deletions.
  appendRecords_(SHEET_NAMES.logs, logRecords);

  // Delta response: the client removes only these rows and updates the counters,
  // instead of reloading and re-rendering everything.
  return {
    removedBatchIds: ids,
    dashboard: getDashboardSummary()
  };
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
  var principalCc = getPrincipalEmailsForGrades_(grades);
  var hodEmail = normalizeEmail_(request.hodEmail || '');
  var ccEmails = principalCc.slice();

  // The HoD from the original submission is always CC'd on the decision email.
  if (hodEmail && ccEmails.indexOf(hodEmail) === -1) {
    ccEmails.push(hodEmail);
  }

  return {
    request: request,
    students: processedStudents,
    batchNote: cleanText_(batchNote || ''),
    principalCc: principalCc,
    hodEmail: hodEmail,
    ccEmails: ccEmails,
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
  // reviewData already contains the request (with its row number),
  // so there is no need to re-read the Requests sheet here.
  var request = reviewData.request;

  // Read the Students sheet ONCE to map student IDs to row numbers,
  // then write each student's two adjacent decision cells in one call.
  var rowByStudentId = {};
  getStudentsByBatchId_(batchId).forEach(function(student) {
    rowByStudentId[student.studentId] = student.__rowNumber;
  });

  var studentSheet = getSheet_(SHEET_NAMES.students);
  var headerMap = getHeaderMap_(SHEET_NAMES.students);
  var statusColumn = headerMap['Decision Status'] + 1;

  reviewData.students.forEach(function(student) {
    var rowNumber = rowByStudentId[student.studentId];

    if (!rowNumber) {
      throw new Error('Student record not found.');
    }

    // 'Decision Status' and 'Decision Note' are adjacent columns.
    studentSheet.getRange(rowNumber, statusColumn, 1, 2).setValues([[
      student.decisionStatus,
      cleanText_(student.decisionNote || '')
    ]]);
  });

  updateRecordByRow_(SHEET_NAMES.requests, request.__rowNumber, {
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
    principalCc: reviewData.principalCc,
    hodEmail: reviewData.hodEmail || ''
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
      decisionSummary: parseJson_(record['Decision Summary']),
      hodEmail: normalizeEmail_(record['HoD Email'] || '')
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
