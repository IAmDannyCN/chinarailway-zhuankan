'use strict';

const searchFields = ['query', 'yearFrom', 'yearTo', 'topic', 'kind', 'volume', 'sort'];
const routeMemory = new Map();
let currentRoute;
let routeSequence = Date.now();

function searchFormValues() {
  return Object.fromEntries(searchFields.map(id => [id, $(id).value]));
}

function rememberRoute() {
  if (!currentRoute) return;
  const snapshot = {
    ...currentRoute,
    shelfScroll: $('scopeList').scrollTop,
    ...(issueView ? {target: issueView.anchor, chapterScroll: $('issueContents').scrollTop} : {
      entry: selected?.id, page, visibleLimit, resultScroll: $('results').scrollTop,
      readerScroll: $('viewer').scrollTop, hitIndex
    })
  };
  routeMemory.set(currentRoute.key, snapshot);
}

function renderRoute(route, previous, restoring = false) {
  for (const [id, value] of Object.entries(route.form || {})) $(id).value = value;
  if (route.mode === 'issue') {
    const document = catalog.docs.find(doc => doc.id === route.issue);
    if (!document) return;
    const nextTerms = route.terms || [];
    if (issueView?.document !== document || terms.join('\0') !== nextTerms.join('\0')) {
      terms = nextTerms;
      openIssue(document);
    }
    if (route.chapterScroll != null) $('issueContents').scrollTop = route.chapterScroll;
    if (route.viewKey !== previous?.viewKey) {
      jumpInIssue(route.target || {p: 0, start: true}, !restoring);
    }
  } else if (route.viewKey !== previous?.viewKey) {
    closeIssue();
    search(route);
  }

  const dialog = $('scopeDialog');
  if (route.shelf) {
    if (!dialog.open) dialog.showModal();
    if (route.shelfScroll != null) $('scopeList').scrollTop = route.shelfScroll;
  } else if (dialog.open) dialog.close();
}

function pushRoute(route, sameView = false) {
  rememberRoute();
  const key = ++routeSequence;
  const next = {...route, key, viewKey: sameView ? currentRoute.viewKey : key};
  history.pushState(next, '');
  const previous = currentRoute;
  currentRoute = next;
  renderRoute(next, previous);
}

function navigateSearch() {
  pushRoute({mode: 'search', form: searchFormValues()});
}

function navigateEntry(id, targetPage) {
  pushRoute({mode: 'search', form: searchFormValues(), entry: id, page: targetPage,
    resultScroll: $('results').scrollTop, visibleLimit});
}

function navigateIssue(id, target = {p: 0, start: true}, fromSearch = false) {
  const keepTerms = issueView?.document.id === id || fromSearch;
  pushRoute({mode: 'issue', issue: id, target, terms: keepTerms ? [...terms] : [], form: searchFormValues(),
    chapterScroll: issueView?.document.id === id ? $('issueContents').scrollTop : 0});
}

function toggleShelf() {
  if ($('scopeDialog').open) history.back();
  else pushRoute({...currentRoute, shelf: true}, true);
}

function initializeNavigation() {
  const saved = history.state;
  const valid = saved?.mode === 'search' ||
    (saved?.mode === 'issue' && catalog.docs.some(doc => doc.id === saved.issue));
  const initial = valid ? saved :
    {mode: 'search', key: routeSequence, viewKey: routeSequence, form: searchFormValues()};
  routeSequence = Math.max(routeSequence, initial.key);
  history.scrollRestoration = 'manual';
  history.replaceState(initial, '');
  currentRoute = initial;
  renderRoute(initial);
  window.addEventListener('popstate', event => {
    if (!event.state?.mode) return;
    rememberRoute();
    const previous = currentRoute;
    const remembered = routeMemory.get(event.state.key);
    currentRoute = remembered || event.state;
    renderRoute(currentRoute, previous, !!remembered);
  });
}
