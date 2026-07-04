var EMAIL_TEMPLATES = {
  'Recurring Glitched Attempt': {
    Approved: {
      headline: 'Approved Recurring Glitched Attempt',
      instruction: 'The recorded grade exception has been approved based on the submitted technical evidence.'
    },
    Rejected: {
      headline: 'Rejected Recurring Glitched Attempt',
      instruction: 'The submitted evidence did not support a grade exception under the recurring glitched attempt policy.'
    }
  },
  'Suspended Account': {
    Approved: {
      headline: 'Approved Suspended Account Request',
      instruction: 'The grade restoration request has been approved based on Academic Deans Office verification of official school records.'
    },
    Rejected: {
      headline: 'Rejected Suspended Account Request',
      instruction: 'The request could not be approved after verification against official school records.'
    }
  },
  'Academic Integrity': {
    Approved: {
      headline: 'Approved Academic Integrity Review',
      instruction: 'The request has been approved after Academic Deans Office review of the submitted integrity case and supporting documentation.'
    },
    Rejected: {
      headline: 'Rejected Academic Integrity Review',
      instruction: 'The request could not be approved after Academic Deans Office review of the integrity case.'
    }
  }
};

function buildEmailPreviewData_(reviewData, settings) {
  var ccEmails = reviewData.ccEmails || reviewData.principalCc || [];

  return {
    to: reviewData.request.teacherEmail,
    cc: ccEmails.join(', '),
    subject: formatAcademicYearShort_(settings.academicYear) + ' | [' + settings.schoolName + '] Academic Exception Review: ' + reviewData.request.batchId,
    htmlBody: buildDecisionEmailHtml_(reviewData, settings),
    plainBody: buildDecisionEmailPlainText_(reviewData, settings),
    testMode: settings.testMode
  };
}

// Converts the Academic Year setting to a short prefix for email subjects.
// "2026-2027" -> "26/27". If the setting is already short (e.g. "26/27")
// or in a custom format, it is used exactly as typed, so the Academic Dean
// can control the prefix manually from Dashboard -> Settings at any time.
function formatAcademicYearShort_(academicYear) {
  var value = cleanText_(academicYear);
  var match = value.match(/\d{2}(\d{2})\s*[-\/]\s*(?:\d{2})?(\d{2})/);

  return match ? match[1] + '/' + match[2] : value;
}

function getDecisionEmailPreview(batchId, decisions, batchNote) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  return buildEmailPreviewData_(buildBatchReviewData_(batchId, decisions, batchNote), getAppSettings());
}

function sendDecisionEmail(batchId, decisions, batchNote) {
  ensureWorkbookReady();
  requireAcademicOffice_();

  // Build the review data and settings ONCE, and derive the preview from them,
  // instead of reading the Requests and Students sheets twice.
  var reviewData = buildBatchReviewData_(batchId, decisions, batchNote);
  var settings = getAppSettings();
  var preview = buildEmailPreviewData_(reviewData, settings);

  if (!preview.to) {
    throw new Error('Teacher email is missing.');
  }

  try {
    if (settings.testMode) {
      writeLog_('Email Simulated In Test Mode', batchId, JSON.stringify({
        to: preview.to,
        cc: preview.cc
      }));
    } else {
      MailApp.sendEmail({
        to: preview.to,
        cc: preview.cc,
        subject: preview.subject,
        htmlBody: preview.htmlBody,
        body: preview.plainBody
      });
      writeLog_('Email Sent', batchId, JSON.stringify({
        to: preview.to,
        cc: preview.cc
      }));
    }
  } catch (error) {
    writeLog_('Email Failed', batchId, error.message || String(error));
    throw new Error('Gmail could not send the batch email. The request remains pending.');
  }

  markBatchProcessed_(batchId, reviewData);

  // Delta response: the client removes this one card and updates the counters.
  return {
    removedBatchIds: [batchId],
    dashboard: getDashboardSummary()
  };
}

function buildDecisionEmailHtml_(reviewData, settings) {
  var request = reviewData.request;
  var summary = reviewData.summary;
  var sections = Object.keys(summary.byExceptionType).map(function(exceptionType) {
    return buildExceptionTypeSectionHtml_(exceptionType, summary.byExceptionType[exceptionType]);
  }).join('');

  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f7fc;padding:24px;color:#0d2b4d;">',
    '<div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #d7e2ef;border-radius:18px;overflow:hidden;">',
    '<div style="padding:24px 28px;background:#0d2b4d;color:#ffffff;">',
    '<div style="font-size:28px;font-weight:700;line-height:1.2;">Academic Exception Review</div>',
    '<div style="margin-top:8px;font-size:14px;opacity:0.92;">Official Academic Affairs Report</div>',
    '</div>',
    '<div style="padding:24px 28px;">',
    '<table style="width:100%;border-collapse:collapse;margin-bottom:22px;">',
    buildMetaRowHtml_('Batch Number', request.batchId),
    buildMetaRowHtml_('Teacher Name', request.teacherName),
    buildMetaRowHtml_('Submission Date', request.submittedAt),
    buildMetaRowHtml_('Processing Date', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')),
    buildMetaRowHtml_('Academic Year', settings.academicYear),
    '</table>',
    sections,
    buildSummarySectionHtml_(summary, reviewData.batchNote),
    '<div style="margin-top:26px;font-size:13px;color:#4a6288;">This email was generated by the Academic Exception Management System.</div>',
    '</div></div></div>'
  ].join('');
}

function buildMetaRowHtml_(label, value) {
  return [
    '<tr>',
    '<td style="padding:8px 0;font-weight:700;width:180px;color:#4a6288;">', escapeHtml_(label), '</td>',
    '<td style="padding:8px 0;color:#0d2b4d;">', escapeHtml_(value || ''), '</td>',
    '</tr>'
  ].join('');
}

function buildExceptionTypeSectionHtml_(exceptionType, buckets) {
  var template = EMAIL_TEMPLATES[exceptionType];
  var approvedHtml = buildDecisionBucketHtml_('Approved', buckets.approved || [], template);
  var rejectedHtml = buildDecisionBucketHtml_('Rejected', buckets.rejected || [], template);

  return [
    '<div style="margin-top:24px;border:1px solid #d7e2ef;border-radius:14px;overflow:hidden;">',
    '<div style="padding:14px 18px;background:#e8f1fa;font-size:18px;font-weight:700;">', escapeHtml_(exceptionType), '</div>',
    '<div style="padding:18px;">',
    approvedHtml,
    rejectedHtml,
    '</div></div>'
  ].join('');
}

function buildDecisionBucketHtml_(status, students, template) {
  if (!students.length) {
    return '';
  }

  return [
    '<div style="margin-bottom:16px;">',
    '<div style="font-size:15px;font-weight:700;color:', status === 'Approved' ? '#0d7a34' : '#e53935', ';">', escapeHtml_(template[status].headline), '</div>',
    '<div style="margin:6px 0 12px;color:#4a6288;font-size:13px;">', escapeHtml_(template[status].instruction), '</div>',
    students.map(function(student) {
      return buildStudentDecisionCardHtml_(student, status);
    }).join(''),
    '</div>'
  ].join('');
}

function buildStudentDecisionCardHtml_(student, status) {
  return [
    '<div style="border:1px solid #d7e2ef;border-radius:12px;padding:14px 16px;background:#fbfdff;margin-bottom:10px;">',
    '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">',
    '<strong style="font-size:15px;">', escapeHtml_(student.studentName), '</strong>',
    '<span style="font-size:12px;padding:4px 10px;border-radius:999px;background:', status === 'Approved' ? '#dff5e6' : '#ffe8e7', ';color:', status === 'Approved' ? '#0d7a34' : '#e53935', ';">', escapeHtml_(status), '</span>',
    '</div>',
    '<div style="margin-top:8px;font-size:13px;color:#4a6288;">',
    escapeHtml_(student.grade + ' | ' + student.subject),
    '</div>',
    '<div style="margin-top:10px;font-size:13px;color:#0d2b4d;">',
    buildStudentDetailHtml_(student),
    '</div>',
    student.decisionNote ? '<div style="margin-top:10px;font-size:13px;color:#4a6288;"><strong>Reason:</strong> ' + escapeHtml_(student.decisionNote) + '</div>' : '',
    '</div>'
  ].join('');
}

function buildStudentDetailHtml_(student) {
  var details = student.details || {};

  if (student.exceptionType === 'Recurring Glitched Attempt' || student.exceptionType === 'Suspended Account') {
    return (details.assignments || []).map(function(assignment) {
      return '<div><strong>' + escapeHtml_(assignment.type) + ':</strong> Requested Grade ' + escapeHtml_(assignment.requestedGrade) + '</div>';
    }).join('');
  }

  if (student.exceptionType === 'Academic Integrity') {
    if (details.incidentType === 'Plagiarism') {
      return [
        '<div><strong>Case:</strong> Plagiarism</div>',
        '<div><strong>Assignment:</strong> ' + escapeHtml_(details.assignment || '') + '</div>',
        details.description ? '<div><strong>Description:</strong> ' + escapeHtml_(details.description) + '</div>' : ''
      ].join('');
    }

    return [
      '<div><strong>Case:</strong> Cheating</div>',
      '<div><strong>Assignment:</strong> ' + escapeHtml_(details.assignment || '') + '</div>',
      '<div><strong>Observed Behaviors:</strong> ' + escapeHtml_((details.behaviors || []).join(', ')) + '</div>',
      details.description ? '<div><strong>Description:</strong> ' + escapeHtml_(details.description) + '</div>' : ''
    ].join('');
  }

  return '';
}

function buildSummarySectionHtml_(summary, batchNote) {
  return [
    '<div style="margin-top:26px;border-top:1px solid #d7e2ef;padding-top:18px;">',
    '<div style="font-size:18px;font-weight:700;margin-bottom:12px;">Summary</div>',
    '<div style="display:flex;gap:16px;flex-wrap:wrap;">',
    '<div style="min-width:160px;padding:14px;border:1px solid #d7e2ef;border-radius:12px;background:#fbfdff;"><div style="font-size:13px;color:#4a6288;">Approved Students</div><div style="font-size:28px;font-weight:700;color:#0d7a34;">' + escapeHtml_(summary.approvedCount) + '</div></div>',
    '<div style="min-width:160px;padding:14px;border:1px solid #d7e2ef;border-radius:12px;background:#fbfdff;"><div style="font-size:13px;color:#4a6288;">Rejected Students</div><div style="font-size:28px;font-weight:700;color:#e53935;">' + escapeHtml_(summary.rejectedCount) + '</div></div>',
    '</div>',
    batchNote ? '<div style="margin-top:14px;font-size:13px;color:#4a6288;"><strong>Academic Office Note:</strong> ' + escapeHtml_(batchNote) + '</div>' : '',
    '</div>'
  ].join('');
}

function buildDecisionEmailPlainText_(reviewData, settings) {
  var lines = [
    'Academic Exception Review',
    'Batch Number: ' + reviewData.request.batchId,
    'Teacher Name: ' + reviewData.request.teacherName,
    'Submission Date: ' + reviewData.request.submittedAt,
    'Processing Date: ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'),
    'Academic Year: ' + settings.academicYear,
    ''
  ];

  Object.keys(reviewData.summary.byExceptionType).forEach(function(exceptionType) {
    lines.push(exceptionType);
    ['approved', 'rejected'].forEach(function(bucket) {
      var items = reviewData.summary.byExceptionType[exceptionType][bucket];
      if (items.length) {
        lines.push('  ' + bucket.charAt(0).toUpperCase() + bucket.slice(1));
        items.forEach(function(student) {
          lines.push('  - ' + student.studentName + ' | ' + student.grade + ' | ' + student.subject);
        });
      }
    });
    lines.push('');
  });

  lines.push('Summary');
  lines.push('Approved Students: ' + reviewData.summary.approvedCount);
  lines.push('Rejected Students: ' + reviewData.summary.rejectedCount);

  return lines.join('\n');
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
