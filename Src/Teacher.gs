function submitTeacherRequest(payload) {
  ensureWorkbookReady();
  validateTeacherRequest_(payload);

  var batchId = getNextBatchId_();
  var submittedAt = new Date();
  var userContext = getCurrentUserContext_();
  var studentList = payload.students || [];

  // Reserve every ID with one counter read + one counter write,
  // then write all student rows with a single batched setValues call.
  var studentIds = reserveStudentIds_(studentList.length);
  var students = [];

  var studentRecords = studentList.map(function(student, index) {
    var studentId = studentIds[index];
    var storedDetails = prepareStudentDetailsForStorage_(student, batchId, studentId);

    students.push(studentId);

    return {
      'Batch ID': batchId,
      'Student ID': studentId,
      'Student Name': cleanText_(student.studentName),
      'Grade': student.grade,
      'Subject': student.subject,
      'Exception Type': student.exceptionType,
      'Details': JSON.stringify(storedDetails),
      'Decision Status': DECISION_STATUS.pending,
      'Decision Note': ''
    };
  });

  appendRecords_(SHEET_NAMES.students, studentRecords);

  appendRecord_(SHEET_NAMES.requests, {
    'Batch ID': batchId,
    'Teacher Name': cleanText_(payload.teacherName),
    'Teacher Email': normalizeEmail_(payload.teacherEmail),
    'Submitted At': submittedAt,
    'Status': REQUEST_STATUS.pending,
    'Student Count': students.length,
    'Decision At': '',
    'Decision By': '',
    'Decision Note': '',
    'Email Sent At': '',
    'Submitted By': userContext.email,
    'Submitted By Role': userContext.role,
    'Principal CC': '',
    'Decision Summary': '',
    'HoD Email': normalizeEmail_(payload.hodEmail)
  });

  writeLog_('Request Submitted', batchId, JSON.stringify({
    studentCount: students.length,
    submittedBy: userContext.email,
    submittedByRole: userContext.role
  }));

  return {
    batchId: batchId,
    studentCount: students.length
  };
}

function validateTeacherRequest_(payload) {
  var userContext = getCurrentUserContext_();
  var formConfig = getFormConfig();

  if (!payload) {
    throw new Error('Request information is required.');
  }

  if (!cleanText_(payload.teacherName)) {
    throw new Error('Teacher name is required.');
  }

  if (!isValidEmail_(payload.teacherEmail)) {
    throw new Error('A valid teacher email is required.');
  }

  if (!isValidEmail_(payload.hodEmail)) {
    throw new Error('A valid Head of Department (HoD) email is required.');
  }

  if (!payload.students || !payload.students.length) {
    throw new Error('At least one student is required.');
  }

  if (!userContext.isAcademicOffice && payload.submitMode === 'on-behalf') {
    throw new Error('Only Academic Office users can submit on behalf of another teacher.');
  }

  payload.students.forEach(function(student, index) {
    validateStudentRequest_(student, index, formConfig);
  });
}

function validateStudentRequest_(student, index, formConfig) {
  var itemNumber = index + 1;

  if (!cleanText_(student.studentName)) {
    throw new Error('Student name is required for student ' + itemNumber + '.');
  }

  if (getSupportedGrades().indexOf(student.grade) === -1) {
    throw new Error('A supported grade is required for student ' + itemNumber + '.');
  }

  if (getSupportedSubjects().indexOf(student.subject) === -1) {
    throw new Error('A supported subject is required for student ' + itemNumber + '.');
  }

  if (getSupportedExceptionTypes().indexOf(student.exceptionType) === -1) {
    throw new Error('A supported exception type is required for student ' + itemNumber + '.');
  }

  if (student.exceptionType === 'Recurring Glitched Attempt') {
    validateAssignmentBasedException_(student.details, formConfig.recurringAssignments, true, itemNumber);
  }

  if (student.exceptionType === 'Suspended Account') {
    validateAssignmentBasedException_(student.details, formConfig.suspendedAssignments, false, itemNumber);
  }

  if (student.exceptionType === 'Academic Integrity') {
    validateAcademicIntegrity_(student.details, formConfig, itemNumber);
  }
}

function validateAssignmentBasedException_(details, assignments, requiresEvidence, itemNumber) {
  var map = {};

  assignments.forEach(function(assignment) {
    map[assignment.name] = assignment.maxGrade;
  });

  if (!details || !details.assignments || !details.assignments.length) {
    throw new Error('At least one assignment is required for student ' + itemNumber + '.');
  }

  details.assignments.forEach(function(assignment) {
    if (!map.hasOwnProperty(assignment.type)) {
      throw new Error('Unsupported assignment type for student ' + itemNumber + '.');
    }

    var requestedGrade = Number(assignment.requestedGrade);
    if (isNaN(requestedGrade) || requestedGrade < 0 || requestedGrade > map[assignment.type]) {
      throw new Error('Requested grade for ' + assignment.type + ' must be between 0 and ' + map[assignment.type] + ' for student ' + itemNumber + '.');
    }

    if (requiresEvidence && (!assignment.evidenceFiles || !assignment.evidenceFiles.length)) {
      throw new Error('Evidence is required for each selected assignment for student ' + itemNumber + '.');
    }
  });
}

function validateAcademicIntegrity_(details, formConfig, itemNumber) {
  if (!details || ['Plagiarism', 'Cheating'].indexOf(details.incidentType) === -1) {
    throw new Error('Academic Integrity type is required for student ' + itemNumber + '.');
  }

  if (details.incidentType === 'Plagiarism') {
    if (formConfig.academicIntegrityAssignments.plagiarism.indexOf(details.assignment) === -1) {
      throw new Error('A valid plagiarism assignment is required for student ' + itemNumber + '.');
    }

    if (!details.evidenceCategories || !details.evidenceCategories.length) {
      throw new Error('At least one evidence category is required for plagiarism for student ' + itemNumber + '.');
    }

    if (!details.evidenceFiles || !details.evidenceFiles.length) {
      throw new Error('Evidence upload is required for plagiarism for student ' + itemNumber + '.');
    }
  }

  if (details.incidentType === 'Cheating') {
    if (formConfig.academicIntegrityAssignments.cheating.indexOf(details.assignment) === -1) {
      throw new Error('A valid cheating assignment is required for student ' + itemNumber + '.');
    }

    if (!details.behaviors || !details.behaviors.length) {
      throw new Error('At least one observed behavior is required for cheating for student ' + itemNumber + '.');
    }

    if (!cleanText_(details.description)) {
      throw new Error('A written description is required for cheating for student ' + itemNumber + '.');
    }
  }
}

function prepareStudentDetailsForStorage_(student, batchId, studentId) {
  var details = JSON.parse(JSON.stringify(student.details || {}));

  if (student.exceptionType === 'Recurring Glitched Attempt' || student.exceptionType === 'Suspended Account') {
    details.assignments = (details.assignments || []).map(function(assignment) {
      return {
        type: assignment.type,
        requestedGrade: Number(assignment.requestedGrade),
        evidenceFiles: uploadEvidenceFiles_(assignment.evidenceFiles || [], batchId, studentId, assignment.type)
      };
    });
  }

  if (student.exceptionType === 'Academic Integrity') {
    details.evidenceFiles = uploadEvidenceFiles_(details.evidenceFiles || [], batchId, studentId, details.incidentType || 'Academic Integrity');
  }

  details.description = cleanText_(details.description || '');
  details.submittedMessage = student.exceptionType === 'Suspended Account'
    ? 'Evidence will be verified by the Academic Affairs Office using the school\'s official records.'
    : '';

  return details;
}

function uploadEvidenceFiles_(files, batchId, studentId, label) {
  if (!files || !files.length) {
    return [];
  }

  var folder = getEvidenceFolder_();

  return files.map(function(file, index) {
    var blob = Utilities.newBlob(
      Utilities.base64Decode(file.base64Data),
      file.mimeType || 'application/octet-stream',
      file.fileName || ('evidence-' + index)
    );
    var safeLabel = cleanText_(label || 'evidence').replace(/[^A-Za-z0-9]+/g, '-');
    var storedFile = folder.createFile(blob).setName(batchId + '_' + studentId + '_' + safeLabel + '_' + cleanText_(file.fileName || ('file-' + index)));

    return {
      name: storedFile.getName(),
      url: storedFile.getUrl(),
      mimeType: file.mimeType || '',
      category: cleanText_(file.category || ''),
      assignmentType: cleanText_(file.assignmentType || '')
    };
  });
}

function getEvidenceFolder_() {
  var spreadsheetFile = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  var parents = spreadsheetFile.getParents();
  var parentFolder = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folders = parentFolder.getFoldersByName('AEMS Evidence');

  return folders.hasNext() ? folders.next() : parentFolder.createFolder('AEMS Evidence');
}

function cleanText_(value) {
  return String(value || '').trim();
}

function isValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanText_(value));
}
