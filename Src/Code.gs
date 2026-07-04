function doGet() {
  // Full verification runs on page load so a missing sheet is always repaired
  // before use; individual server calls afterwards skip it via the cache flag.
  ensureWorkbookReady(true);

  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('AEMS')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

function getInitialData() {
  ensureWorkbookReady();

  var user = getCurrentUserContext_();
  var snapshot = user.isAcademicOffice ? buildOfficeSnapshot_() : getEmptySnapshot_();

  return {
    user: user,
    settings: getAppSettings(),
    grades: getSupportedGrades(),
    subjects: getSupportedSubjects(),
    exceptionTypes: getSupportedExceptionTypes(),
    formConfig: getFormConfig(),
    dashboard: snapshot.dashboard,
    pendingRequests: snapshot.pendingRequests
  };
}

function getHomeData() {
  ensureWorkbookReady();

  var user = getCurrentUserContext_();
  var snapshot = user.isAcademicOffice ? buildOfficeSnapshot_() : getEmptySnapshot_();

  return {
    user: user,
    settings: getAppSettings(),
    dashboard: snapshot.dashboard,
    pendingRequests: snapshot.pendingRequests
  };
}

function getEmptySnapshot_() {
  return {
    dashboard: { pending: 0, approved: 0, rejected: 0, total: 0 },
    pendingRequests: []
  };
}

function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail() || '';
}
