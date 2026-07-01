function doGet() {
  ensureWorkbookReady();

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

  return {
    user: getCurrentUserContext_(),
    settings: getAppSettings(),
    grades: getSupportedGrades(),
    subjects: getSupportedSubjects(),
    exceptionTypes: getSupportedExceptionTypes(),
    formConfig: getFormConfig(),
    dashboard: getCurrentUserContext_().isAcademicOffice ? getDashboardSummary() : { pending: 0, approved: 0, rejected: 0, total: 0 },
    pendingRequests: getCurrentUserContext_().isAcademicOffice ? getPendingRequests() : []
  };
}

function getHomeData() {
  ensureWorkbookReady();

  return {
    user: getCurrentUserContext_(),
    settings: getAppSettings(),
    dashboard: getCurrentUserContext_().isAcademicOffice ? getDashboardSummary() : { pending: 0, approved: 0, rejected: 0, total: 0 },
    pendingRequests: getCurrentUserContext_().isAcademicOffice ? getPendingRequests() : []
  };
}

function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail() || '';
}
