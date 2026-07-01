var SHEET_NAMES = {
  settings: 'Settings',
  requests: 'Requests',
  students: 'Students',
  logs: 'System Log',
  archive: 'Archive'
};

var ROLE_TYPES = {
  teacher: 'Teacher',
  academicOffice: 'Academic Office'
};

var REQUEST_STATUS = {
  pending: 'Pending',
  completed: 'Completed',
  deleted: 'Deleted'
};

var DECISION_STATUS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected'
};

var REQUEST_HEADERS = [
  'Batch ID',
  'Teacher Name',
  'Teacher Email',
  'Submitted At',
  'Status',
  'Student Count',
  'Decision At',
  'Decision By',
  'Decision Note',
  'Email Sent At',
  'Submitted By',
  'Submitted By Role',
  'Principal CC',
  'Decision Summary'
];

var STUDENT_HEADERS = [
  'Batch ID',
  'Student ID',
  'Student Name',
  'Grade',
  'Subject',
  'Exception Type',
  'Details',
  'Decision Status',
  'Decision Note'
];

var LOG_HEADERS = [
  'Timestamp',
  'Action',
  'Batch ID',
  'User',
  'Details'
];

var ARCHIVE_HEADERS = [
  'Archived At',
  'Academic Year',
  'Requests',
  'Students',
  'Logs'
];

var PRINCIPAL_MAPPING_DEFAULTS = [
  {
    label: 'Elementary School',
    grades: ['G/Y3', 'G/Y4', 'G/Y5'],
    gradeSettingKey: 'Elementary Principal Grades',
    emailSettingKey: 'Elementary Principal Email'
  },
  {
    label: 'Middle School',
    grades: ['G/Y6', 'G/Y7', 'G/Y8'],
    gradeSettingKey: 'Middle School Principal Grades',
    emailSettingKey: 'Middle School Principal Email'
  },
  {
    label: 'High School',
    grades: ['G/Y9', 'G10', 'G11', 'G12'],
    gradeSettingKey: 'High School Principal Grades',
    emailSettingKey: 'High School Principal Email'
  }
];

function getSupportedGrades() {
  return ['G/Y3', 'G/Y4', 'G/Y5', 'G/Y6', 'G/Y7', 'G/Y8', 'G/Y9', 'G10', 'G11', 'G12'];
}

function getSupportedSubjects() {
  return [
    'English',
    'Math',
    'Calculus',
    'Statistics',
    'Mechanics',
    'Science',
    'Physical Science',
    'Biology',
    'Advanced Biology',
    'Chemistry',
    'Physics',
    'History',
    'Social Studies',
    'Global Perspective',
    'Economics',
    'Political Science',
    'Business',
    'Psychology',
    'Sociology',
    'French',
    'German',
    'Arabic',
    'Arabic Social Studies'
  ];
}

function getSupportedExceptionTypes() {
  return ['Suspended Account', 'Recurring Glitched Attempt', 'Academic Integrity'];
}

function getFormConfig() {
  return {
    recurringAssignments: [
      { name: 'Flipped Classroom', maxGrade: 3 },
      { name: 'Exit Ticket', maxGrade: 5 },
      { name: 'Quiz', maxGrade: 20 }
    ],
    suspendedAssignments: [
      { name: 'Flipped Classroom', maxGrade: 3 },
      { name: 'Exit Ticket', maxGrade: 5 },
      { name: 'Quiz', maxGrade: 20 }
    ],
    academicIntegrityAssignments: {
      plagiarism: ['Classwork', 'Homework', 'Flipped Classroom', 'Exit Ticket', 'Quiz'],
      cheating: ['Quiz', 'Exit Ticket', 'Flipped Classroom']
    },
    plagiarismEvidenceTypes: [
      'AI Detection Report',
      'Similarity Report',
      'Copied Student Work',
      'Other Supporting Documents'
    ],
    cheatingBehaviors: [
      'Opened another browser tab',
      'Opened unauthorized materials',
      'Used AI tools',
      'Told another student the answer',
      'Looked at another student\'s answers',
      'Transferred information between students'
    ]
  };
}

function ensureWorkbookReady() {
  var spreadsheet = SpreadsheetApp.getActive();

  ensureSheetWithHeaders_(spreadsheet, SHEET_NAMES.settings, ['Key', 'Value']);
  ensureSheetWithHeaders_(spreadsheet, SHEET_NAMES.requests, REQUEST_HEADERS);
  ensureSheetWithHeaders_(spreadsheet, SHEET_NAMES.students, STUDENT_HEADERS);
  ensureSheetWithHeaders_(spreadsheet, SHEET_NAMES.logs, LOG_HEADERS);
  ensureSheetWithHeaders_(spreadsheet, SHEET_NAMES.archive, ARCHIVE_HEADERS);

  seedSetting_('Academic Year', getDefaultAcademicYear_());
  seedSetting_('School Name', 'School Name');
  seedSetting_('Test Mode', 'TRUE');
  seedSetting_('Ticket Counter', '0');
  seedSetting_('Batch Counter', '0');
  seedSetting_('Academic Dean Email', '');
  seedSetting_('Associate Academic Dean Email', '');

  PRINCIPAL_MAPPING_DEFAULTS.forEach(function(mapping) {
    seedSetting_(mapping.gradeSettingKey, mapping.grades.join(', '));
    seedSetting_(mapping.emailSettingKey, '');
  });
}

function getAppSettings() {
  ensureWorkbookReady();

  var settingsMap = getSettingsMap_();
  var principalMappings = PRINCIPAL_MAPPING_DEFAULTS.map(function(mapping) {
    return {
      label: mapping.label,
      grades: normalizeGradeList_(settingsMap[mapping.gradeSettingKey] || mapping.grades.join(', ')),
      email: normalizeEmail_(settingsMap[mapping.emailSettingKey] || ''),
      gradeSettingKey: mapping.gradeSettingKey,
      emailSettingKey: mapping.emailSettingKey
    };
  });

  return {
    academicYear: settingsMap['Academic Year'] || getDefaultAcademicYear_(),
    schoolName: settingsMap['School Name'] || 'School Name',
    testMode: String(settingsMap['Test Mode']).toUpperCase() !== 'FALSE',
    academicDeanEmail: normalizeEmail_(settingsMap['Academic Dean Email'] || ''),
    associateAcademicDeanEmail: normalizeEmail_(settingsMap['Associate Academic Dean Email'] || ''),
    principalMappings: principalMappings
  };
}

function saveAppSettings(settings) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  if (!settings) {
    throw new Error('Settings are required.');
  }

  validateSettingsPayload_(settings);

  updateSetting_('Academic Year', cleanText_(settings.academicYear || getDefaultAcademicYear_()));
  updateSetting_('School Name', cleanText_(settings.schoolName || 'School Name'));
  updateSetting_('Test Mode', settings.testMode ? 'TRUE' : 'FALSE');
  updateSetting_('Academic Dean Email', normalizeEmail_(settings.academicDeanEmail || ''));
  updateSetting_('Associate Academic Dean Email', normalizeEmail_(settings.associateAcademicDeanEmail || ''));

  (settings.principalMappings || []).forEach(function(mapping) {
    if (mapping.gradeSettingKey) {
      updateSetting_(mapping.gradeSettingKey, normalizeGradeList_(mapping.grades).join(', '));
    }
    if (mapping.emailSettingKey) {
      updateSetting_(mapping.emailSettingKey, normalizeEmail_(mapping.email || ''));
    }
  });

  writeLog_('Settings Updated', '', JSON.stringify(getAppSettings()));

  return getAppSettings();
}

function archiveAcademicYear(newAcademicYear) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  var settings = getAppSettings();
  var requestRows = getDataRows_(SHEET_NAMES.requests);
  var studentRows = getDataRows_(SHEET_NAMES.students);
  var logRows = getDataRows_(SHEET_NAMES.logs);
  var archiveSheet = getSheet_(SHEET_NAMES.archive);

  archiveSheet.appendRow([
    new Date(),
    settings.academicYear,
    JSON.stringify(requestRows),
    JSON.stringify(studentRows),
    JSON.stringify(logRows)
  ]);

  clearDataRows_(SHEET_NAMES.requests);
  clearDataRows_(SHEET_NAMES.students);
  clearDataRows_(SHEET_NAMES.logs);
  updateSetting_('Ticket Counter', '0');
  updateSetting_('Batch Counter', '0');
  updateSetting_('Academic Year', cleanText_(newAcademicYear || getDefaultAcademicYear_()));
  writeLog_('Academic Year Archived', '', 'Archived ' + settings.academicYear);

  return getHomeData();
}

function getNextBatchId_() {
  var next = Number(getSetting_('Batch Counter') || 0) + 1;
  updateSetting_('Batch Counter', String(next));
  return 'BATCH-' + new Date().getFullYear() + '-' + Utilities.formatString('%05d', next);
}

function getNextStudentId_() {
  var next = Number(getSetting_('Ticket Counter') || 0) + 1;
  updateSetting_('Ticket Counter', String(next));
  return 'STU-' + Utilities.formatString('%05d', next);
}

function getSettingsMap_() {
  var values = getSheet_(SHEET_NAMES.settings).getDataRange().getValues();
  var settings = {};

  for (var i = 1; i < values.length; i++) {
    if (values[i][0]) {
      settings[values[i][0]] = values[i][1];
    }
  }

  return settings;
}

function getCurrentUserContext_() {
  var email = normalizeEmail_(getCurrentUserEmail());
  var settings = getAppSettings();
  var officeEmails = [
    normalizeEmail_(settings.academicDeanEmail),
    normalizeEmail_(settings.associateAcademicDeanEmail)
  ].filter(Boolean);
  var bootstrapOffice = officeEmails.length === 0 && Boolean(email);

  return {
    email: email,
    role: officeEmails.indexOf(email) > -1 || bootstrapOffice ? ROLE_TYPES.academicOffice : ROLE_TYPES.teacher,
    isAcademicOffice: officeEmails.indexOf(email) > -1 || bootstrapOffice
  };
}

function requireAcademicOffice_() {
  if (!getCurrentUserContext_().isAcademicOffice) {
    throw new Error('This action is available only to Academic Office users.');
  }
}

function getPrincipalMappings_() {
  return getAppSettings().principalMappings || [];
}

function getPrincipalEmailsForGrades_(grades) {
  var gradeSet = {};
  var cc = [];

  (grades || []).forEach(function(grade) {
    gradeSet[grade] = true;
  });

  getPrincipalMappings_().forEach(function(mapping) {
    var hasMatchingGrade = mapping.grades.some(function(grade) {
      return gradeSet[grade];
    });

    if (hasMatchingGrade && mapping.email && cc.indexOf(mapping.email) === -1) {
      cc.push(mapping.email);
    }
  });

  return cc;
}

function getSheet_(sheetName) {
  return SpreadsheetApp.getActive().getSheetByName(sheetName);
}

function ensureSheetWithHeaders_(spreadsheet, sheetName, headers) {
  var sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  var headerRange = sheet.getRange(1, 1, 1, headers.length);
  var existingHeaders = headerRange.getValues()[0];
  var hasHeaders = existingHeaders.join('') !== '';

  if (!hasHeaders || existingHeaders.length < headers.length || existingHeaders.join('|') !== headers.join('|')) {
    headerRange.setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getHeaderMap_(sheetName) {
  var headers = getSheet_(sheetName).getRange(1, 1, 1, getSheet_(sheetName).getLastColumn()).getValues()[0];
  var map = {};

  headers.forEach(function(header, index) {
    map[header] = index;
  });

  return map;
}

function getSheetRecords_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];

  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues().map(function(row, index) {
    var record = { __rowNumber: index + 2 };

    headers.forEach(function(header, headerIndex) {
      record[header] = row[headerIndex];
    });

    return record;
  }).filter(function(record) {
    return record[headers[0]];
  });
}

function appendRecord_(sheetName, record) {
  var sheet = getSheet_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(header) {
    return record[header] !== undefined ? record[header] : '';
  });

  sheet.appendRow(row);
}

function updateRecordByRow_(sheetName, rowNumber, updates) {
  var sheet = getSheet_(sheetName);
  var headerMap = getHeaderMap_(sheetName);

  Object.keys(updates).forEach(function(header) {
    if (headerMap[header] !== undefined) {
      sheet.getRange(rowNumber, headerMap[header] + 1).setValue(updates[header]);
    }
  });
}

function seedSetting_(key, value) {
  if (getSetting_(key) === '') {
    updateSetting_(key, value);
  }
}

function getSetting_(key) {
  var sheet = getSheet_(SHEET_NAMES.settings);
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      return values[i][1];
    }
  }

  return '';
}

function updateSetting_(key, value) {
  var sheet = getSheet_(SHEET_NAMES.settings);
  var values = sheet.getDataRange().getValues();

  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }

  sheet.appendRow([key, value]);
}

function getDataRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    return [];
  }

  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
}

function clearDataRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
}

function getDefaultAcademicYear_() {
  var now = new Date();
  var year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return year + '-' + (year + 1);
}

function normalizeEmail_(value) {
  return cleanText_(value).toLowerCase();
}

function normalizeGradeList_(value) {
  var items = Array.isArray(value) ? value : String(value || '').split(/[\n,]+/);

  return items.map(function(item) {
    return cleanText_(item);
  }).filter(function(item, index, array) {
    return item && array.indexOf(item) === index;
  });
}

function validateSettingsPayload_(settings) {
  ['academicDeanEmail', 'associateAcademicDeanEmail'].forEach(function(field) {
    if (settings[field] && !isValidEmail_(settings[field])) {
      throw new Error('A valid email is required for ' + field + '.');
    }
  });

  (settings.principalMappings || []).forEach(function(mapping) {
    if (mapping.email && !isValidEmail_(mapping.email)) {
      throw new Error('A valid principal email is required for ' + mapping.label + '.');
    }

    normalizeGradeList_(mapping.grades).forEach(function(grade) {
      if (getSupportedGrades().indexOf(grade) === -1) {
        throw new Error('Unsupported grade in principal mapping: ' + grade);
      }
    });
  });
}

function parseJson_(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function serializeDate_(value) {
  if (!value) {
    return '';
  }

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  return String(value);
}

function writeLog_(action, batchId, details) {
  appendRecord_(SHEET_NAMES.logs, {
    'Timestamp': new Date(),
    'Action': action,
    'Batch ID': batchId || '',
    'User': getCurrentUserEmail(),
    'Details': details || ''
  });
}
