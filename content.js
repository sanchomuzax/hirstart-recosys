// --- Debug funkciók ---
function isDebugActive() {
  return new URLSearchParams(window.location.search).get("debug") === "recosys";
}
function debugLog(...args) {
  if (isDebugActive()) {
    console.log(...args);
  }
}
function debugError(...args) {
  if (isDebugActive()) {
    console.error(...args);
  }
}

// --- DOM elemek cache-elése ---
const domCache = new Map();

function getCachedById(id) {
  if (domCache.has(id)) {
    const el = domCache.get(id);
    if (!document.contains(el)) {
      domCache.delete(id);
    } else {
      return el;
    }
  }
  const el = document.getElementById(id);
  if (el) {
    domCache.set(id, el);
  }
  return el;
}

function getCachedElement(selector) {
  if (domCache.has(selector)) {
    const el = domCache.get(selector);
    if (!document.contains(el)) {
      domCache.delete(selector);
    } else {
      return el;
    }
  }
  const el = document.querySelector(selector);
  if (el) {
    domCache.set(selector, el);
  }
  return el;
}

// --- Template cache-elése ---
let cachedTemplate = null;
async function getTemplate() {
  if (cachedTemplate !== null) return cachedTemplate;
  try {
    cachedTemplate = await fetch(chrome.runtime.getURL('template.html')).then(response => response.text());
    return cachedTemplate;
  } catch (error) {
    debugError('HSreco: Nem sikerült a template betöltése:', error);
    throw error;
  }
}

// --- chrome.storage wrapper-ek ---
function getStorageData(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve(result);
    });
  });
}

function setStorageData(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) {
        return reject(chrome.runtime.lastError);
      }
      resolve();
    });
  });
}

// --- Konstansok ---
const MAX_LINKS = 500;      // Maximális tárolható rel ID-k száma
const MAX_CLICKS = 200;     // Maximális kattintások száma, amit tárolunk
const DISPLAY_COUNT = 5;    // Megjelenítendő kattintott sorok száma a lebegő dobozban
const TOP_COUNT = 10;       // Megjelenítendő top domain és kategória szám
const TOP_LINKS = 5;        // Top linkek száma, amiből véletlenszerűen választunk

// Kiemelt cikk dobozának ID-je
const HIGHLIGHTED_ARTICLE_BOX_ID = 'hirstart-highlighted-article-box';

// --- Inicializálás ---
(async function initStorage() {
  try {
    const result = await getStorageData(['clickData', 'domainCounts', 'tematikaCounts', 'relIdList']);
    if (!result.clickData) {
      debugLog('HSreco: clickData nem létezik, létrehozás és createFloatingBox hívás');
      await setStorageData({ clickData: [], domainCounts: {}, tematikaCounts: {}, relIdList: [] });
    } else {
      debugLog('HSreco: clickData létezik, createFloatingBox hívás');
    }
    createFloatingBox();
  } catch (error) {
    debugError('HSreco: Hiba az inicializálás során:', error);
  }
})();

// --- Segédfüggvények ---

// Domain kinyerése URL-ből
function extractDomain(url) {
  try {
    let link = new URL(url, window.location.origin);
    let domain = link.hostname.replace(/^www\./, '');
    return domain;
  } catch (e) {
    debugError('HSreco: Invalid URL:', url);
    return '';
  }
}

// Rel ID kivonása ("hs_" után)
function extractRelId(rel) {
  let match = rel.match(/hs_(\d+)_-?\d+/);
  if (match) {
    debugLog('HSreco: Kinyert rel ID:', match[1]);
    return match[1];
  }
  return null;
}

// relIdList kezelése: ha a lista hossza elérte a maximumot, töröljük a legrégebbi elemeket
async function addRelIdToList(relId) {
  try {
    const result = await getStorageData(['relIdList']);
    let relIdList = result.relIdList || [];
    debugLog('HSreco: Jelenlegi relIdList:', relIdList);
    while (relIdList.length >= MAX_LINKS) {
      relIdList.shift();
    }
    if (!relIdList.includes(relId)) {
      relIdList.push(relId);
      debugLog('HSreco: Új relId hozzáadva:', relId);
    } else {
      debugLog('HSreco: Ez a relId már szerepel a listában:', relId);
    }
    await setStorageData({ relIdList });
    const resultAfterSet = await getStorageData(['relIdList']);
    debugLog('HSreco: relIdList mentés után visszaolvasva:', resultAfterSet.relIdList);
  } catch (error) {
    debugError('HSreco: Hiba a relIdList frissítése során:', error);
  }
}

// --- Kattintás esemény figyelése ---
document.addEventListener('click', function(event) {
  let element = event.target.closest('a[href]');
  if (element) {
    let relAttribute = element.getAttribute('rel');
    let relId = null;
    if (relAttribute) {
      relId = extractRelId(relAttribute);
      if (relId) {
        debugLog('HSreco: relId megtalálva és hozzáadása a listához:', relId);
        addRelIdToList(relId);
      } else {
        debugLog('HSreco: Nem sikerült relId-t találni.');
      }
    } else {
      debugLog('HSreco: rel attribútum nem található.');
    }
    let domain = extractDomain(element.href);
    if (domain.endsWith('hirstart.hu')) {
      debugLog('HSreco: Hirstart.hu domainhez tartozó kattintás, nem mentjük:', domain);
      return;
    }
    let category = getCategory(element);
    addClickEntry(domain, category, relId);
  }
});

// --- Kategória kinyerése ---
function extractCategoryFromHref(href) {
  if (!href) return null;
  href = href.trim();
  debugLog('HSreco: extractCategoryFromHref - href:', href);
  let url;
  try {
    if (href.startsWith('//')) {
      url = new URL(window.location.protocol + href);
    } else if (href.startsWith('http://') || href.startsWith('https://')) {
      url = new URL(href);
    } else {
      url = new URL(href, window.location.origin);
    }
  } catch (e) {
    debugLog('HSreco: Invalid href:', href);
    return null;
  }
  let pathname = url.pathname;
  debugLog('HSreco: Parsed pathname:', pathname);
  let matchPhp = pathname.match(/\/([a-zA-Z0-9_-]+)\.php$/);
  if (matchPhp) {
    debugLog('HSreco: Matched .php category:', matchPhp[1]);
    return matchPhp[1].toLowerCase();
  }
  let matchNoPhp = pathname.match(/\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  if (matchNoPhp) {
    debugLog('HSreco: Matched non-.php category:', matchNoPhp[1]);
    return matchNoPhp[1].toLowerCase();
  }
  let searchParams = new URLSearchParams(url.search);
  if (searchParams.has('category')) {
    let categoryFromQuery = searchParams.get('category').toLowerCase();
    debugLog('HSreco: Kategória query paraméterből:', categoryFromQuery);
    return categoryFromQuery;
  }
  debugLog('HSreco: Nincs kategória matched for pathname:', pathname);
  return null;
}

function getCategory(element) {
  let categoryLink = element.closest('div')?.querySelector('a.rovat');
  if (categoryLink) {
    let href = categoryLink.getAttribute('href');
    debugLog('HSreco: Kategória link megtalálva a "div" alatt:', href);
    return extractCategoryFromHref(href);
  }
  let widgetFooter = element.closest('div.osszes_box, a.osszes');
  if (widgetFooter) {
    let categoryLink = widgetFooter.querySelector('a[href]');
    if (categoryLink) {
      let href = categoryLink.getAttribute('href');
      debugLog('HSreco: Kategória link megtalálva a "osszes_box" vagy "osszes" alatt:', href);
      return extractCategoryFromHref(href);
    }
  }
  let h2Element = element.closest('div.fooldalBox')?.querySelector('h2 a[href]');
  if (h2Element) {
    let href = h2Element.getAttribute('href');
    debugLog('HSreco: Kategória link megtalálva a "fooldalBox" alatt:', href);
    return extractCategoryFromHref(href);
  }
  let currentPageCategory = extractCategoryFromHref(window.location.pathname);
  if (currentPageCategory) {
    debugLog('HSreco: Kategória kinyerve az aktuális oldal URL-jéből:', currentPageCategory);
    return currentPageCategory;
  }
  debugLog('HSreco: Kategória nem található az elemhez.');
  return null;
}

// --- Kattintási bejegyzés hozzáadása ---
async function addClickEntry(domain, category, relId) {
  try {
    const { clickData = [], domainCounts = {}, tematikaCounts = {} } = await getStorageData(['clickData', 'domainCounts', 'tematikaCounts']);
    
    let newEntry = { domain, timestamp: Date.now() };
    if (category !== null && category !== undefined) {
      newEntry.category = category;
      debugLog('HSreco: Kategória hozzáadva a newEntry-hez:', category);
    }
    if (relId) {
      newEntry.relId = relId;
    }
    clickData.push(newEntry);
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    if (category) {
      tematikaCounts[category] = (tematikaCounts[category] || 0) + 1;
    }
    
    // Biztosítjuk, hogy a clickData lista hossza ne lépje túl a MAX_CLICKS értéket
    while (clickData.length > MAX_CLICKS) {
      let removed = clickData.shift();
      let removedDomain = removed.domain;
      domainCounts[removedDomain] -= 1;
      if (domainCounts[removedDomain] === 0) {
        delete domainCounts[removedDomain];
      }
      if (removed.category) {
        let removedCategory = removed.category;
        tematikaCounts[removedCategory] -= 1;
        if (tematikaCounts[removedCategory] === 0) {
          delete tematikaCounts[removedCategory];
        }
      }
    }
    
    await setStorageData({ clickData, domainCounts, tematikaCounts });
    updateFloatingBox();
  } catch (error) {
    debugError('HSreco: Hiba a storage adatok frissítése során:', error);
  }
}

// --- Ellenőrzi, hogy az elem vagy valamelyik őse el van-e rejtve ---
function isHidden(element) {
  while (element) {
    if (element.classList && element.classList.contains('sourcehidden')) {
      return true;
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none') {
      return true;
    }
    element = element.parentElement;
  }
  return false;
}

// --- Lebegő doboz frissítése (Info panel) ---
async function updateFloatingBox() {
  try {
    const { clickData = [], domainCounts = {}, tematikaCounts = {}, relIdList = [] } = await getStorageData(['clickData', 'domainCounts', 'tematikaCounts', 'relIdList']);
    
    let displayData = clickData.slice(-DISPLAY_COUNT).reverse();
    debugLog('HSreco: Jelenlegi megtekintett hírek (relIdList):', relIdList);
    let topDomains = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COUNT);
    let topTematikas = Object.entries(tematikaCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_COUNT);
    let box = getCachedById('hirstart-click-tracker');
    if (!box) return;
    
    const template = await getTemplate();
    box.style.display = 'none';
    box.innerHTML = template
      .replace(/\{\{MAX_CLICKS\}\}/g, MAX_CLICKS)
      .replace(/\{\{MAX_LINKS\}\}/g, MAX_LINKS);
    let countDiv = box.querySelector('#hirstart-count');
    countDiv.innerHTML = `
          <span class="hirstart-label">Domain:</span> ${Object.keys(domainCounts).length} / ${MAX_CLICKS}<br>
          <span class="hirstart-label">Tematika:</span> ${Object.keys(tematikaCounts).length} / ${MAX_CLICKS}<br>
          <span class="hirstart-label">Megtekintett hírek:</span> ${relIdList.length} / ${MAX_LINKS}<br>
        `;
    let entriesDiv = box.querySelector('#hirstart-entries');
    entriesDiv.innerHTML = displayData.map(entry => {
      return entry.relId
        ? `${entry.domain} / ${(entry.category !== undefined && entry.category !== null) ? entry.category : 'N/A'} / ${entry.relId}`
        : `${entry.domain} / ${(entry.category !== undefined && entry.category !== null) ? entry.category : 'N/A'}`;
    }).join('<br>');
    let topDomainsList = box.querySelector('.hirstart-top:nth-child(1) .hirstart-list');
    topDomainsList.innerHTML = topDomains.map(([domain, count]) => `<li>${domain}: ${count}</li>`).join('');
    let topTematikasList = box.querySelector('.hirstart-top:nth-child(2) .hirstart-list');
    topTematikasList.innerHTML = topTematikas.map(([category, count]) => `<li>${category}: ${count}</li>`).join('');
    refreshHighlightArticle();
    let closeBtn = box.querySelector('#hirstart-close-btn');
    closeBtn.onclick = () => { box.style.display = 'none'; };
    const params = new URLSearchParams(window.location.search);
    box.style.display = (params.get("debug") === "recosys") ? 'block' : 'none';
  } catch (error) {
    debugError('HSreco: Hiba a floating box frissítése során:', error);
  }
}

// --- Kiemelt cikk frissítése ---
function refreshHighlightArticle() {
  let oldHighlightedBox = getCachedById(HIGHLIGHTED_ARTICLE_BOX_ID);
  if (oldHighlightedBox) {
    oldHighlightedBox.remove();
    debugLog("HSreco: Előző kiemelt cikk doboz eltávolítva.");
  }
  highlightTopArticle();
}

// --- Kiemelt cikk kiválasztása ---
async function highlightTopArticle() {
  try {
    const { domainCounts = {}, tematikaCounts = {}, relIdList = [] } = await getStorageData(['domainCounts', 'tematikaCounts', 'relIdList']);
    let articles = document.querySelectorAll('div.boxhir, div.rovidhir');
    let candidateArticles = [];
    articles.forEach(article => {
      if (isHidden(article)) return;
      let domainLink = article.querySelector('a[href]');
      let articleDomain = domainLink ? extractDomain(domainLink.href) : null;
      if (!articleDomain || !domainCounts.hasOwnProperty(articleDomain)) return;
      let categoryLink = article.querySelector('a.rovat[href]');
      let articleCategory = categoryLink ? extractCategoryFromHref(categoryLink.getAttribute('href')) : null;
      let relAttribute = article.querySelector('a[rel]')?.getAttribute('rel');
      let relId = relAttribute ? extractRelId(relAttribute) : null;
      if (!relId || relIdList.includes(relId)) return;
      let num_link = 1;
      num_link *= domainCounts[articleDomain] || 1;
      num_link *= (articleCategory && tematikaCounts[articleCategory]) ? tematikaCounts[articleCategory] : 1;
      candidateArticles.push({
        article: article,
        num_link: num_link
      });
    });
    if (candidateArticles.length === 0) return;
    candidateArticles.sort((a, b) => b.num_link - a.num_link);
    let topCandidates = candidateArticles.slice(0, TOP_LINKS);
    let randomIndex = Math.floor(Math.random() * topCandidates.length);
    let selectedArticle = topCandidates[randomIndex].article;
    moveArticleToHighlightedBox(selectedArticle);
  } catch (error) {
    debugError('HSreco: Hiba a kiemelt cikk kiválasztása során:', error);
  }
}

// --- Kiemelt cikk áthelyezése ---
function moveArticleToHighlightedBox(article) {
  debugLog('HSreco: moveArticleToHighlightedBox called');
  let highlightedBox = getCachedById(HIGHLIGHTED_ARTICLE_BOX_ID);
  if (!highlightedBox) {
    debugLog('HSreco: highlightedBox nem létezik, létrehozás.');
    let contents = getCachedById('contents');
    if (!contents) {
      debugLog('HSreco: Nem található <div id="contents">, így a highlightedBox nem jelenik meg.');
      return;
    }
    highlightedBox = document.createElement('div');
    highlightedBox.id = HIGHLIGHTED_ARTICLE_BOX_ID;
    highlightedBox.classList.add('highlightArticle');
    highlightedBox.classList.add('_ce_measure_widget');
    highlightedBox.setAttribute("data-ce-measure-widget", "highlightArticle");
    contents.appendChild(highlightedBox);
    debugLog('HSreco: highlightedBox létrehozva.');
  }
  let clonedArticle = article.cloneNode(true);
  let oldCloseButton = clonedArticle.querySelector('.highlight-close-btn');
  if (oldCloseButton) {
    oldCloseButton.remove();
  }
  let closeButton = document.createElement('span');
  closeButton.className = 'highlight-close-btn';
  closeButton.textContent = '×';
  closeButton.onclick = function() {
    let relAttribute = clonedArticle.querySelector('a[rel]')?.getAttribute('rel');
    let relId = null;
    if (relAttribute) {
      relId = extractRelId(relAttribute);
      if (relId) {
        (async () => {
          try {
            const { relIdList = [] } = await getStorageData(['relIdList']);
            if (!relIdList.includes(relId)) {
              relIdList.push(relId);
              await setStorageData({ relIdList });
              debugLog('HSreco: relId hozzáadva az ignorált hírek listájához:', relId);
            }
            refreshHighlightArticle();
          } catch (error) {
            debugError('HSreco: Hiba a relId ignorált listához adásakor:', error);
          }
        })();
      } else {
        refreshHighlightArticle();
      }
    } else {
      refreshHighlightArticle();
    }
  };
  clonedArticle.style.position = 'relative';
  clonedArticle.appendChild(closeButton);
  highlightedBox.innerHTML = '';
  highlightedBox.appendChild(clonedArticle);
  debugLog('HSreco: Cikk áthelyezve a highlightedBox-ba.');
}

// --- Lebegő doboz létrehozása (Info panel) ---
function createFloatingBox() {
  if (getCachedById('hirstart-click-tracker')) return;
  let box = document.createElement('div');
  box.id = 'hirstart-click-tracker';
  box.style.display = 'none';
  getTemplate().then(template => {
    box.innerHTML = template
      .replace(/\{\{MAX_CLICKS\}\}/g, MAX_CLICKS)
      .replace(/\{\{MAX_LINKS\}\}/g, MAX_LINKS);
    document.body.appendChild(box);
    debugLog('HSreco: Lebegő doboz létrehozva.');
    updateFloatingBox();
    const params = new URLSearchParams(window.location.search);
    box.style.display = (params.get("debug") === "recosys") ? 'block' : 'none';
  }).catch(error => debugError('HSreco: Nem sikerült a template betöltése:', error));
}

// --- DOM betöltése után ---
document.addEventListener('DOMContentLoaded', function() {
  highlightTopArticle();
  createFloatingBox();
});
